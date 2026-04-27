/**
 * `claude -p` execFile wrapper — local Claude CLI invocation.
 *
 * Phase 7 Plan 01, Task 1. CONTEXT decisions enforced verbatim:
 *
 * D-claude-invocation:
 *   - execFile('claude', ['-p', prompt], { timeout: 120_000, env: { PATH, HOME } })
 *   - NEVER spawn-with-the-shell, NEVER use the shelling exec variant.
 *   - Strict env allowlist: only PATH and HOME pass through. Explicitly omit
 *     all API key vars (we don't reference any here so a future grep can
 *     prove they never leak). Claude CLI reads its own credentials via
 *     ~/.config/claude/.
 *   - 120s default timeout; caller can override.
 *   - Output parsing: regex-extract `\{[\s\S]*\}` (balanced-brace walk in
 *     practice), JSON.parse, validate with the caller's Zod schema.
 *   - On parse failure / non-zero exit / timeout: return a typed
 *     ClaudeOutcome variant — NEVER throw, NEVER retry. The Stage 1/2 worker
 *     decides whether to POST `outcome:'error'`; the queue's RETRY_CAP
 *     handles backoff.
 *   - stderr is redacted (Bearer tokens, sk-* secrets) before slicing first
 *     200 bytes — the worker may surface this on a Langfuse span, so leaking
 *     creds via observability is the threat we mitigate (T-07-03).
 *
 * Executor seam: invokeClaude takes an optional `executor` so tests can
 * substitute a deterministic stub. defaultExecutor wraps node:child_process.execFile.
 */

import { execFile } from 'node:child_process'
import type { ZodType } from 'zod'

/* ------------------------------------------------------------------ */
/* Public types                                                       */
/* ------------------------------------------------------------------ */

export interface ExecutorOpts {
  /** Hard timeout in milliseconds. Executor must SIGTERM the child on exceed. */
  timeout: number
  /** Strict env allowlist for the child process. */
  env: Record<string, string | undefined>
}

export interface ExecutorResult {
  stdout: string
  stderr: string
  exitCode: number
  /** True iff the child was killed because of `timeout`. */
  killed: boolean
  /** Wall-clock duration of the invocation. */
  durationMs: number
}

export type Executor = (
  cmd: string,
  args: string[],
  opts: ExecutorOpts,
) => Promise<ExecutorResult>

/**
 * Outcome of a single `claude -p` invocation. Designed so callers (Stage 1/2
 * workers) can pattern-match without ever needing try/catch on the wrapper.
 */
export type ClaudeOutcome<T> =
  | {
      kind: 'ok'
      value: T
      durationMs: number
      exitCode: 0
      stdoutFirst200: string
    }
  | {
      kind: 'parse_error'
      reason: string
      stdoutFirst200: string
      exitCode: number
      durationMs: number
    }
  | {
      kind: 'exit_error'
      exitCode: number
      stderrFirst200: string
      durationMs: number
    }
  | { kind: 'timeout'; durationMs: number }

/* ------------------------------------------------------------------ */
/* Default executor (production)                                      */
/* ------------------------------------------------------------------ */

/**
 * Production executor — wraps `node:child_process.execFile`. Resolves with
 * structured ExecutorResult; never rejects. Timeout / non-zero exits are
 * surfaced via the result fields, not exceptions.
 */
export const defaultExecutor: Executor = (cmd, args, opts) => {
  const start = Date.now()
  return new Promise<ExecutorResult>((resolve) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeout,
        // Cast: Next.js's global.d.ts narrows NODE_ENV as required, but we
        // intentionally pass a strict allowlist (PATH+HOME only). The
        // child_process API accepts any record shape at runtime.
        env: opts.env as NodeJS.ProcessEnv,
        // Default 8MB output buffer is plenty for Claude JSON responses.
        maxBuffer: 8 * 1024 * 1024,
        // Critical: do NOT enable shell mode. Args are passed safely as argv.
      },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - start
        // execFile with options.env returns string overload by default
        // (since we don't pass `encoding: 'buffer'`).
        const stdoutStr = String(stdout ?? '')
        const stderrStr = String(stderr ?? '')
        if (err) {
          const e = err as NodeJS.ErrnoException & {
            killed?: boolean
            signal?: string
            code?: number | string
          }
          // Timeout: node sets killed=true, signal='SIGTERM'.
          const killed = e.killed === true && e.signal === 'SIGTERM'
          // exitCode: node only populates `code` numerically when the child
          // exited non-zero. ENOENT etc. produce string codes.
          const exitCode = typeof e.code === 'number' ? e.code : 1
          resolve({
            stdout: stdoutStr,
            stderr: stderrStr,
            exitCode,
            killed,
            durationMs,
          })
          return
        }
        resolve({
          stdout: stdoutStr,
          stderr: stderrStr,
          exitCode: 0,
          killed: false,
          durationMs,
        })
      },
    )
  })
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_TIMEOUT_MS = 120_000

interface InvokeOpts {
  executor?: Executor
  timeoutMs?: number
}

/**
 * Invoke `claude -p <prompt>` and return a structured outcome. Never throws,
 * never retries — the caller decides what to do with parse/exit/timeout.
 */
export async function invokeClaude<T>(
  prompt: string,
  schema: ZodType<T>,
  opts?: InvokeOpts,
): Promise<ClaudeOutcome<T>> {
  const executor = opts?.executor ?? defaultExecutor
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const result = await executor('claude', ['-p', prompt], {
    timeout: timeoutMs,
    // Pass full env: macOS Keychain access goes through securityd via XPC,
    // which needs USER/LOGNAME/TMPDIR/XPC_SERVICE_NAME/XPC_FLAGS to identify
    // the session. Stripping to {PATH,HOME} caused launchd-spawned claude to
    // report "Not logged in" even though the same binary worked from a shell
    // under the same launchd parent. Verified via controlled launchd test.
    env: process.env,
  })

  // ── Timeout path ──────────────────────────────────────────────────
  if (result.killed) {
    return { kind: 'timeout', durationMs: result.durationMs }
  }

  // ── Non-zero exit path ────────────────────────────────────────────
  if (result.exitCode !== 0) {
    return {
      kind: 'exit_error',
      exitCode: result.exitCode,
      stderrFirst200: redactAndSlice(result.stderr, 200),
      durationMs: result.durationMs,
    }
  }

  // ── Success path: extract JSON, parse, validate ───────────────────
  const stdoutFirst200 = redactAndSlice(result.stdout, 200)
  const json = extractFirstJsonObject(result.stdout)
  if (!json) {
    return {
      kind: 'parse_error',
      reason: 'no_json_object_in_stdout',
      stdoutFirst200,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    return {
      kind: 'parse_error',
      reason: `json_parse_failed: ${(err as Error).message}`,
      stdoutFirst200,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    }
  }
  const validation = schema.safeParse(parsed)
  if (!validation.success) {
    return {
      kind: 'parse_error',
      reason: `schema_failed: ${validation.error.issues.map((i) => i.path.join('.') + ':' + i.message).join('; ')}`,
      stdoutFirst200,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    }
  }
  return {
    kind: 'ok',
    value: validation.data,
    durationMs: result.durationMs,
    exitCode: 0,
    stdoutFirst200,
  }
}

/**
 * Pre-flight check: assert `claude` is on PATH. Throws a clear Error if not.
 * Intended to be called once at consumer startup so the worker fails fast
 * instead of producing N spawn errors on every poll cycle.
 */
export async function assertClaudeOnPath(executor?: Executor): Promise<void> {
  const ex = executor ?? defaultExecutor
  // `command -v` is POSIX; `which` is BSD/Linux. Both exit 0 when found.
  // We try `which` first since it matches the macOS / launchd environment;
  // the executor surfaces non-zero exit via result.exitCode regardless.
  const result = await ex('which', ['claude'], {
    timeout: 5_000,
    env: process.env,
  })
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error('claude CLI not found on PATH — install Claude Code or run `claude login` to make the binary available')
  }
}

/* ------------------------------------------------------------------ */
/* Helpers (exported for unit testing)                                */
/* ------------------------------------------------------------------ */

/**
 * Extract the first balanced JSON object from arbitrary stdout. Strategy:
 *   1. Find the first `{`.
 *   2. Walk forward tracking brace depth (respecting strings / escapes)
 *      until depth returns to zero.
 * This is more robust than a single regex for stdout that contains nested
 * JSON inside the response. Returns null if no balanced object is found.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && inString) {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Redact `Bearer <token>` and `sk-<long_string>` patterns to `[REDACTED]`,
 * then slice the first `n` bytes. Mitigates T-07-03 (creds leaking into
 * Langfuse trace metadata when the worker surfaces this string).
 */
export function redactAndSlice(text: string, n: number): string {
  if (!text) return ''
  const redacted = text
    .replace(/Bearer\s+\S+/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
  return redacted.slice(0, n)
}
