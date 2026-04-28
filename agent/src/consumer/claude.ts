/**
 * `claude -p` execFile wrapper — local Claude CLI invocation.
 *
 * Phase 7 Plan 01, Task 1. CONTEXT decisions enforced verbatim:
 *
 * D-claude-invocation:
 *   - execFile('claude', ['-p', prompt, ...mcp-args], { timeout: 120_000, env: scrubAnthropicKeys(process.env) })
 *   - NEVER spawn-with-the-shell, NEVER use the shelling exec variant.
 *   - 120s default timeout; caller can override.
 *   - Output parsing: regex-extract balanced `{...}` blocks, walk LAST→first
 *     until JSON.parse succeeds, validate with the caller's Zod schema.
 *   - On parse failure / non-zero exit / timeout: return a typed
 *     ClaudeOutcome variant — NEVER throw, NEVER retry. The Stage 2 worker
 *     decides whether to POST `outcome:'error'`; the queue's RETRY_CAP
 *     handles backoff.
 *   - stderr is redacted (Bearer tokens, sk-* secrets) before slicing first
 *     200 bytes — the worker may surface this on a Langfuse span, so leaking
 *     creds via observability is the threat we mitigate (T-07-03).
 *
 * Quick task 260428-lx4 Task 3 (MCP plumbing):
 *   - Build a temporary MCP config JSON file declaring the cortex stdio MCP
 *     server (agent/dist/mcp/cortex-tools.js) with CORTEX_API_URL and
 *     CORTEX_API_KEY in its env. Pass --mcp-config <tmpfile>,
 *     --strict-mcp-config, --allowedTools "<3 qualified cortex tools>".
 *   - tmpfile lives under os.tmpdir() (T-lx4-01); cleanup runs in finally so
 *     a crash leaves at most one ephemeral config behind.
 *   - extractFinalJsonObject scans all balanced top-level brace ranges and
 *     returns the LAST one whose JSON.parse succeeds — multi-turn output
 *     after tool calls puts the assistant's decision JSON last.
 *   - Iteration cap: the executor's 120s wall-clock timeout is the ONLY
 *     governor. The CLI runs against the Code subscription (env scrub strips
 *     ANTHROPIC_API_KEY) so per-invocation cost caps don't apply.
 *
 * Executor seam: invokeClaude takes an optional `executor` so tests can
 * substitute a deterministic stub. defaultExecutor wraps node:child_process.execFile.
 */

import { execFile } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
 * Outcome of a single `claude -p` invocation. Designed so callers (Stage 2
 * worker) can pattern-match without ever needing try/catch on the wrapper.
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
/* MCP config constants (lx4 Task 3)                                  */
/* ------------------------------------------------------------------ */

/**
 * The 3 qualified cortex MCP tool names allowed in --allowedTools. The MCP
 * server name (in the config JSON) is `cortex`, so the model sees each tool
 * as `mcp__cortex__<tool_name>`. The cortex-tools server registers the
 * unqualified names cortex_paths_internal, cortex_label_samples,
 * cortex_path_feedback.
 */
export const ALLOWED_TOOLS =
  'mcp__cortex__cortex_paths_internal,mcp__cortex__cortex_label_samples,mcp__cortex__cortex_path_feedback'


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
        env: opts.env as NodeJS.ProcessEnv,
        // Default 8MB output buffer is plenty for Claude JSON responses.
        maxBuffer: 8 * 1024 * 1024,
        // Critical: do NOT enable shell mode. Args are passed safely as argv.
      },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - start
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
 * Resolve the absolute path to the cortex-tools MCP server entry point. The
 * agent compiles to agent/dist/{consumer,mcp}/, so claude.js sits next to
 * mcp/cortex-tools.js after build.
 *
 * We resolve from process.cwd() walking up to find the agent root, because
 * the source layout is the same shape under both ts-jest (src/) and the
 * production build (dist/). The launchd plist sets cwd to the agent root.
 *
 * For unit tests under ts-jest the cwd is the repo root (cortex/). We probe
 * a few likely candidates: the dist path next to claude.js (production) and
 * the source path under agent/src/mcp/cortex-tools.ts (tests). The probe
 * order biases production (dist .js wins under launchd because it ships
 * compiled JS).
 */
function resolveCortexToolsPath(): string {
  // ts-jest sets `__dirname` (CJS); the production tsx/launchd loader
  // exposes it via the synthetic `__dirname` shim that tsx provides for
  // ESM-as-CJS interop. Either way, `__dirname` is defined at runtime —
  // we declare it as `any` to dodge the TS module-mode check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const here: string = (globalThis as any).__dirname
    ?? (typeof __dirname !== 'undefined' ? __dirname : '')
  if (here) {
    // claude.{ts,js} lives in {agent}/{src|dist}/consumer/. Sibling of
    // consumer/ is mcp/. Compose the dist filename (production build).
    return resolve(here, '..', 'mcp', 'cortex-tools.js')
  }
  // Fallback: assume cwd is the agent root (launchd plist sets this).
  return resolve(process.cwd(), 'dist', 'mcp', 'cortex-tools.js')
}

/**
 * Build the MCP config tmpfile contents. Spawns the cortex stdio server with
 * CORTEX_API_URL + CORTEX_API_KEY in its env so it can authenticate to the
 * Next.js API. The tmpfile path is randomized per invocation so concurrent
 * Stage 2 workers do not collide.
 */
function writeMcpConfigTmpfile(): { tmpPath: string; cleanup: () => void } {
  const apiUrl = process.env.CORTEX_API_URL ?? ''
  const apiKey = process.env.CORTEX_API_KEY ?? ''
  const cortexToolsPath = resolveCortexToolsPath()
  const config = {
    mcpServers: {
      cortex: {
        command: 'node',
        args: [cortexToolsPath],
        env: {
          CORTEX_API_URL: apiUrl,
          CORTEX_API_KEY: apiKey,
        },
      },
    },
  }
  const fileName = `cortex-mcp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.json`
  const tmpPath = join(tmpdir(), fileName)
  // os.tmpdir() defaults to 0700/0755 perms on macOS+Linux; the file inherits
  // umask. We don't chmod explicitly — the threat (T-lx4-01) is bounded by
  // the per-user tmpdir + the unlink in finally.
  writeFileSync(tmpPath, JSON.stringify(config), 'utf8')
  return {
    tmpPath,
    cleanup: () => {
      try {
        unlinkSync(tmpPath)
      } catch {
        /* best-effort — file may already be gone */
      }
    },
  }
}

/**
 * Invoke `claude -p <prompt>` and return a structured outcome. Never throws,
 * never retries — the caller decides what to do with parse/exit/timeout.
 *
 * lx4 Task 3: passes --mcp-config + --strict-mcp-config + --allowedTools.
 * The tmpfile is written before spawn, unlinked in finally.
 */
export async function invokeClaude<T>(
  prompt: string,
  schema: ZodType<T>,
  opts?: InvokeOpts,
): Promise<ClaudeOutcome<T>> {
  const executor = opts?.executor ?? defaultExecutor
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const { tmpPath, cleanup } = writeMcpConfigTmpfile()

  let result: ExecutorResult
  try {
    result = await executor(
      'claude',
      [
        '-p',
        prompt,
        '--mcp-config',
        tmpPath,
        '--strict-mcp-config',
        '--allowedTools',
        ALLOWED_TOOLS,
      ],
      {
        timeout: timeoutMs,
        // Pass full env BUT scrub Anthropic-bound API keys.
        //
        // Why full env: macOS Keychain access goes through securityd via XPC,
        // which needs USER/LOGNAME/TMPDIR/XPC_SERVICE_NAME/XPC_FLAGS to identify
        // the session. Stripping to {PATH,HOME} caused launchd-spawned claude to
        // report "Not logged in" even though the same binary worked from a shell
        // under the same launchd parent.
        //
        // Why scrub ANTHROPIC_API_KEY / CLAUDE_API_KEY: this project ships
        // .env.local with ANTHROPIC_API_KEY (used by the Vercel API for the
        // OpenAI/Anthropic SDK clients, not by the local CLI). If that var is
        // visible to `claude -p`, the CLI bills against API credits instead of
        // the user's Claude Code subscription — silently draining a metered
        // budget that wasn't intended for batch classification. The Stage 2
        // worker is a Code-subscription consumer, not an API consumer.
        //
        // CORTEX_API_KEY DOES flow through (post-lx4): the spawned MCP server
        // (cortex-tools) needs it to authenticate to /api/paths/internal etc.
        // The MCP config tmpfile sets it in the cortex server's env explicitly;
        // claude itself does not consume it.
        env: scrubAnthropicKeys(process.env),
      },
    )
  } finally {
    cleanup()
  }

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

  // ── Success path: extract FINAL JSON, parse, validate ────────────
  // lx4 Task 3: multi-turn output after tool calls interleaves tool I/O JSON
  // blocks with the final assistant message. The decision JSON is LAST.
  const stdoutFirst200 = redactAndSlice(result.stdout, 200)
  const json = extractFinalJsonObject(result.stdout)
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
    env: scrubAnthropicKeys(process.env),
  })
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error('claude CLI not found on PATH — install Claude Code or run `claude login` to make the binary available')
  }
}

/* ------------------------------------------------------------------ */
/* Helpers (exported for unit testing)                                */
/* ------------------------------------------------------------------ */

/**
 * Extract the FIRST balanced JSON object from arbitrary stdout. Strategy:
 *   1. Find the first `{`.
 *   2. Walk forward tracking brace depth (respecting strings / escapes)
 *      until depth returns to zero.
 * This is more robust than a single regex for stdout that contains nested
 * JSON inside the response. Returns null if no balanced object is found.
 *
 * Kept exported for backwards compat (extractFinalJsonObject below is the
 * post-lx4 multi-turn-aware variant; some single-shot tests still target this).
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
 * Walk all balanced top-level `{...}` blocks in `text` and return them in
 * source order. Each block respects string-quoting and escape sequences so
 * `{ "text": "{}" }` is one block, not three.
 */
function findAllBalancedBraceRanges(text: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('{', i)
    if (start === -1) break
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (let j = start; j < text.length; j++) {
      const ch = text[j]
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
        if (depth === 0) {
          end = j
          break
        }
      }
    }
    if (end === -1) break // unterminated brace — give up
    out.push(text.slice(start, end + 1))
    i = end + 1
  }
  return out
}

/**
 * Multi-turn-aware variant of extractFirstJsonObject (lx4 Task 3). Returns
 * the LAST balanced `{...}` block in `text` whose JSON.parse succeeds.
 * After tool calls, the assistant's decision JSON comes LAST in stdout —
 * earlier braces are tool-call I/O blocks. JSON.parse-failures are skipped
 * silently so a malformed prefix doesn't shadow a valid suffix.
 */
export function extractFinalJsonObject(text: string): string | null {
  const blocks = findAllBalancedBraceRanges(text)
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      JSON.parse(blocks[i])
      return blocks[i]
    } catch {
      /* skip — try earlier block */
    }
  }
  return null
}

/**
 * Return a copy of `env` with Anthropic-bound API keys removed. Prevents the
 * `claude -p` subprocess from billing against API credits when those vars
 * are present in the parent (e.g. loaded via --env-file=.env.local for the
 * Vercel API's SDK clients). The Code subscription path is taken iff none
 * of these vars are visible to the CLI.
 */
export function scrubAnthropicKeys(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const out = { ...env }
  delete out.ANTHROPIC_API_KEY
  delete out.CLAUDE_API_KEY
  delete out.ANTHROPIC_AUTH_TOKEN
  return out
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
