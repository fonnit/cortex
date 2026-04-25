// scripts/acc/lib/argv-heuristics.mjs — Phase 8 Plan 01 Task 1
//
// Pure parsing logic for `ps -wwo pid,command` output, used by
// scripts/acc/audit-consumer-argv.sh to confirm ACC-04 second half:
//   "consumer subprocess argv never contains file content"
//
// Heuristics (per 08-CONTEXT D-05):
//   - any `claude -p` argv > 16KB  → suspicious (size)
//   - any `claude -p` argv with a NUL byte → suspicious (null_byte)
//
// Pure ESM. Importable from tests; also exposes a `--check` CLI mode
// invoked by the shell script with ps output on stdin.

export const ARGV_SIZE_LIMIT = 16384 // 16KB — D-05

/**
 * Parse a single line from `ps -wwo pid,command` into pid + argv.
 * Returns null for the header line ("PID COMMAND"), blank lines, and
 * sample-separator lines ("---SAMPLE---").
 *
 * @param {string} line
 * @returns {{ pid: number, argv: string } | null}
 */
export function parseArgvLine(line) {
  if (!line) return null
  if (line.includes('---SAMPLE---')) return null
  const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/)
  if (!match) return null
  return { pid: Number(match[1]), argv: match[2] }
}

/**
 * Decide whether an argv string carries the smell of a content-injection
 * (file bytes passed as args). Returns reason='size' or 'null_byte', else
 * { suspicious: false }.
 *
 * @param {string} argv
 * @returns {{ suspicious: boolean, reason?: 'size' | 'null_byte', size?: number }}
 */
export function isSuspiciousArgv(argv) {
  if (typeof argv !== 'string') return { suspicious: false }
  if (argv.length > ARGV_SIZE_LIMIT) {
    return { suspicious: true, reason: 'size', size: argv.length }
  }
  if (argv.includes('\0')) {
    return { suspicious: true, reason: 'null_byte' }
  }
  return { suspicious: false }
}

/**
 * Filter ps output to lines that look like a `claude -p ...` invocation.
 * Anchors the match to either start-of-argv or after a `/` (so absolute
 * paths to `claude` count) and requires the literal token `-p` immediately
 * after. Substring matches inside other commands (e.g. "Claude Helper.app")
 * are rejected.
 *
 * @param {string[]} lines
 * @returns {Array<{ pid: number, argv: string }>}
 */
export function extractClaudeInvocations(lines) {
  const re = /(?:^|\/)claude\s+-p\b/
  const out = []
  for (const line of lines) {
    const parsed = parseArgvLine(line)
    if (!parsed) continue
    if (re.test(parsed.argv)) out.push(parsed)
  }
  return out
}

// ---------------------------------------------------------------------------
// CLI mode: read ps output from stdin, print PASS/FAIL.
//   node scripts/acc/lib/argv-heuristics.mjs --check
//
// Triggered only when this module is run directly (not imported).
// ---------------------------------------------------------------------------
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '')

if (isMain && process.argv.includes('--check')) {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const lines = Buffer.concat(chunks).toString('utf8').split('\n')
  const invocations = extractClaudeInvocations(lines)
  const suspicious = invocations
    .map((inv) => ({ ...inv, ...isSuspiciousArgv(inv.argv) }))
    .filter((x) => x.suspicious)

  if (suspicious.length === 0) {
    console.log(
      `PASS ACC-04 (consumer-argv) — ${invocations.length} 'claude -p' invocations sampled, all clean`,
    )
    process.exit(0)
  }

  console.log(
    `FAIL ACC-04 (consumer-argv) — ${suspicious.length}/${invocations.length} suspicious invocations:`,
  )
  for (const s of suspicious.slice(0, 5)) {
    const snippet = s.argv.slice(0, 200).replace(/\0/g, '\\x00')
    console.log(
      `  pid=${s.pid} reason=${s.reason} size=${s.size ?? s.argv.length} argv[0..200]=${snippet}`,
    )
  }
  process.exit(1)
}
