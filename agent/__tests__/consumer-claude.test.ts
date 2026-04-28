/**
 * `claude -p` wrapper tests — Phase 7 Plan 01, Task 1 + quick task 260428-lx4 Task 3.
 *
 * Tests use the executor-injection seam (no real subprocess spawned). Coverage:
 *   - argv form invocation now includes --mcp-config / --strict-mcp-config /
 *     --allowedTools / --max-budget-usd (lx4 Task 3 wires the agentic loop).
 *   - The tmpfile passed to --mcp-config contains a valid MCP config JSON
 *     spawning agent/dist/mcp/cortex-tools.js with CORTEX_API_URL and
 *     CORTEX_API_KEY in its env.
 *   - The tmpfile is unlinked after the executor resolves (success and failure).
 *   - extractFinalJsonObject finds the LAST balanced JSON object in multi-turn
 *     stdout (final assistant message comes last; earlier braces are tool I/O).
 *   - 120s default timeout; custom override honored.
 *   - JSON regex-extract on stdout, Zod-validated, returned as kind:'ok'.
 *   - Malformed stdout / failed Zod / non-zero exit / timeout — all return
 *     typed kinds without retry.
 *   - stderr redaction for Bearer tokens and sk-* secrets.
 *   - assertClaudeOnPath helper.
 *   - --max-budget-usd exhaustion → exit_error (caller maps to outcome:'error').
 *
 * Plan's anti-pattern guards verified by source-text grep at the bottom:
 *   - execFile, never spawn-with-shell.
 *   - No reference to ANTHROPIC_API_KEY / OPENAI_API_KEY (claude must not bill
 *     against Anthropic API). CORTEX_API_KEY IS allowed post-lx4 — the MCP
 *     config tmpfile is built from process.env.CORTEX_API_KEY so the spawned
 *     cortex-tools server can authenticate to the Next.js API.
 */

import { z } from 'zod'
import {
  invokeClaude,
  defaultExecutor,
  assertClaudeOnPath,
  extractFirstJsonObject,
  extractFinalJsonObject,
  redactAndSlice,
  ALLOWED_TOOLS,
  MAX_BUDGET_USD,
  type Executor,
  type ExecutorResult,
} from '../src/consumer/claude'

const SCHEMA = z.object({
  decision: z.enum(['keep', 'ignore', 'uncertain']),
  confidence: z.number(),
  reason: z.string(),
})

interface CapturedCall {
  cmd: string
  args: string[]
  opts: { timeout: number; env: Record<string, string | undefined> }
}

/** Build an Executor stub that records calls and returns a canned result. */
function stubExecutor(result: Partial<ExecutorResult>, capture?: CapturedCall[]): Executor {
  return async (cmd, args, opts) => {
    capture?.push({ cmd, args, opts })
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
      killed: result.killed ?? false,
      durationMs: result.durationMs ?? 1,
    }
  }
}

const ORIGINAL_API_URL = process.env.CORTEX_API_URL
const ORIGINAL_API_KEY = process.env.CORTEX_API_KEY

beforeEach(() => {
  process.env.CORTEX_API_URL = 'https://cortex.example.com'
  process.env.CORTEX_API_KEY = 'sekret-token'
})

afterAll(() => {
  if (ORIGINAL_API_URL === undefined) {
    delete process.env.CORTEX_API_URL
  } else {
    process.env.CORTEX_API_URL = ORIGINAL_API_URL
  }
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.CORTEX_API_KEY
  } else {
    process.env.CORTEX_API_KEY = ORIGINAL_API_KEY
  }
})

/* ------------------------------------------------------------------ */
/* extractFirstJsonObject (kept for backwards compat, used by tests)   */
/* ------------------------------------------------------------------ */

describe('extractFirstJsonObject', () => {
  it('extracts a plain JSON object', () => {
    expect(extractFirstJsonObject('{"a":1}')).toBe('{"a":1}')
  })
  it('extracts JSON wrapped in prose', () => {
    expect(extractFirstJsonObject('Here is the result: {"a":1} done')).toBe('{"a":1}')
  })
  it('handles nested objects', () => {
    expect(extractFirstJsonObject('x {"a":{"b":2}} y')).toBe('{"a":{"b":2}}')
  })
  it('handles strings containing braces', () => {
    expect(extractFirstJsonObject('{"text":"a {b} c"}')).toBe('{"text":"a {b} c"}')
  })
  it('handles escaped quotes inside strings', () => {
    expect(extractFirstJsonObject('{"text":"he said \\"hi\\""}')).toBe('{"text":"he said \\"hi\\""}')
  })
  it('returns null when no JSON present', () => {
    expect(extractFirstJsonObject('no json')).toBeNull()
    expect(extractFirstJsonObject('')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* extractFinalJsonObject — quick task 260428-lx4 Task 3 (Test A4)     */
/* ------------------------------------------------------------------ */

describe('extractFinalJsonObject', () => {
  it('returns the LAST balanced JSON object on multi-turn stdout', () => {
    // Tool-call block first, then the assistant's final decision JSON.
    const stdout = [
      'TOOL_CALL: {"name":"cortex_paths_internal","arguments":{}}',
      'TOOL_RESULT: {"paths":[]}',
      'ASSISTANT: {"decision":"keep","confidence":0.9,"reason":"final"}',
    ].join('\n')
    const found = extractFinalJsonObject(stdout)
    expect(found).toBe('{"decision":"keep","confidence":0.9,"reason":"final"}')
  })

  it('falls back to the only JSON object on single-shot stdout', () => {
    expect(extractFinalJsonObject('{"a":1}')).toBe('{"a":1}')
  })

  it('returns null when no JSON present', () => {
    expect(extractFinalJsonObject('no json here')).toBeNull()
  })

  it('skips JSON-shaped fragments that fail JSON.parse', () => {
    // The first balanced {...} block is invalid JSON (trailing comma inside
    // an object); the second is valid. extractFinalJsonObject should walk
    // backwards and return the valid block.
    const stdout = '{"a":1,} prefix {"ok":true} suffix'
    expect(extractFinalJsonObject(stdout)).toBe('{"ok":true}')
  })
})

/* ------------------------------------------------------------------ */
/* redactAndSlice                                                     */
/* ------------------------------------------------------------------ */

describe('redactAndSlice', () => {
  it('redacts Bearer tokens', () => {
    expect(redactAndSlice('failed: Bearer abc123def456', 200)).toBe('failed: [REDACTED]')
  })
  it('redacts sk-* secrets', () => {
    expect(redactAndSlice('config: sk-abcdef1234567890XYZ_ok', 200)).toBe('config: [REDACTED]')
  })
  it('slices to n bytes after redaction', () => {
    const stderr = 'Bearer ' + 'x'.repeat(500)
    const out = redactAndSlice(stderr, 50)
    expect(out.length).toBeLessThanOrEqual(50)
    expect(out.startsWith('[REDACTED]')).toBe(true)
  })
  it('returns empty string on empty input', () => {
    expect(redactAndSlice('', 200)).toBe('')
  })
})

/* ------------------------------------------------------------------ */
/* invokeClaude — argv shape + MCP plumbing (Tests A1–A4, A7)          */
/* ------------------------------------------------------------------ */

describe('invokeClaude — argv shape and MCP plumbing (lx4 Task 3)', () => {
  it('Test A1: passes -p, prompt, --mcp-config <tmpfile>, --strict-mcp-config, --allowedTools, --max-budget-usd', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '{"decision":"keep","confidence":0.9,"reason":"r"}' }, calls)
    await invokeClaude('hello world', SCHEMA, { executor: ex })
    expect(calls).toHaveLength(1)
    const args = calls[0].args
    expect(args[0]).toBe('-p')
    expect(args[1]).toBe('hello world')
    expect(args).toContain('--mcp-config')
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--allowedTools')
    expect(args).toContain('--max-budget-usd')

    // --allowedTools value is the comma-separated qualified tool names.
    const idxAllowed = args.indexOf('--allowedTools')
    expect(args[idxAllowed + 1]).toBe(ALLOWED_TOOLS)
    expect(args[idxAllowed + 1]).toContain('mcp__cortex__cortex_paths_internal')
    expect(args[idxAllowed + 1]).toContain('mcp__cortex__cortex_label_samples')
    expect(args[idxAllowed + 1]).toContain('mcp__cortex__cortex_path_feedback')

    // --max-budget-usd value is the configured cap (planner D3: $0.50).
    const idxBudget = args.indexOf('--max-budget-usd')
    expect(args[idxBudget + 1]).toBe(String(MAX_BUDGET_USD))
    expect(MAX_BUDGET_USD).toBe(0.5)
  })

  it('Test A2: the tmpfile contents are a valid MCP config spawning cortex-tools.js with CORTEX_API_URL/KEY in env', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '{"decision":"keep","confidence":0.9,"reason":"r"}' }, calls)

    await invokeClaude('hello world', SCHEMA, { executor: ex })

    const args = calls[0].args
    const tmpPath = args[args.indexOf('--mcp-config') + 1]
    expect(typeof tmpPath).toBe('string')
    expect(tmpPath).toMatch(/cortex-mcp-/)

    // Read tmpfile from the executor capture — but Test A3 unlinks it
    // after the executor resolves, so we capture it inline via a custom
    // executor that reads it during the call.
    const capturedConfig: { value?: string } = {}
    const inspectingEx: Executor = async (cmd, argsIn, opts) => {
      const idx = argsIn.indexOf('--mcp-config')
      const path = argsIn[idx + 1]
      const { readFileSync } = await import('node:fs')
      capturedConfig.value = readFileSync(path, 'utf8')
      return {
        stdout: '{"decision":"keep","confidence":0.9,"reason":"r"}',
        stderr: '',
        exitCode: 0,
        killed: false,
        durationMs: 1,
      }
    }

    await invokeClaude('hello world', SCHEMA, { executor: inspectingEx })
    const cfg = JSON.parse(capturedConfig.value!)
    expect(cfg.mcpServers).toBeDefined()
    expect(cfg.mcpServers.cortex).toBeDefined()
    expect(cfg.mcpServers.cortex.command).toBe('node')
    expect(Array.isArray(cfg.mcpServers.cortex.args)).toBe(true)
    expect(cfg.mcpServers.cortex.args[0]).toMatch(/mcp\/cortex-tools\.(js|ts)$/)
    expect(cfg.mcpServers.cortex.env).toEqual({
      CORTEX_API_URL: 'https://cortex.example.com',
      CORTEX_API_KEY: 'sekret-token',
    })
  })

  it('Test A3: tmpfile is unlinked after the executor resolves (success path)', async () => {
    const { existsSync } = await import('node:fs')
    let observedPath = ''
    const ex: Executor = async (cmd, argsIn) => {
      observedPath = argsIn[argsIn.indexOf('--mcp-config') + 1]
      // file exists during the executor call
      expect(existsSync(observedPath)).toBe(true)
      return {
        stdout: '{"decision":"keep","confidence":0.9,"reason":"r"}',
        stderr: '',
        exitCode: 0,
        killed: false,
        durationMs: 1,
      }
    }
    await invokeClaude('p', SCHEMA, { executor: ex })
    // After invokeClaude returns, the tmpfile MUST be cleaned up.
    expect(existsSync(observedPath)).toBe(false)
  })

  it('Test A3b: tmpfile is unlinked after the executor resolves (failure path)', async () => {
    const { existsSync } = await import('node:fs')
    let observedPath = ''
    const ex: Executor = async (cmd, argsIn) => {
      observedPath = argsIn[argsIn.indexOf('--mcp-config') + 1]
      return {
        stdout: '',
        stderr: 'boom',
        exitCode: 1,
        killed: false,
        durationMs: 1,
      }
    }
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('exit_error')
    expect(existsSync(observedPath)).toBe(false)
  })

  it('Test A4: extracts the FINAL JSON object from multi-turn stdout', async () => {
    // Earlier braces are tool-call blocks; the final assistant JSON is the decision.
    const stdout = [
      '{"name":"cortex_paths_internal","arguments":{}}',
      '{"paths":[]}',
      '{"decision":"keep","confidence":0.9,"reason":"final"}',
    ].join('\n')
    const ex = stubExecutor({ stdout })
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') {
      expect(out.value).toEqual({ decision: 'keep', confidence: 0.9, reason: 'final' })
    }
  })

  it('Test A7: --max-budget-usd exhaustion → exit_error (worker maps to outcome:error)', async () => {
    // Claude exits non-zero when the budget cap is hit; the wrapper surfaces this
    // as kind:'exit_error' which the Stage 2 worker maps to outcome:'error'.
    const ex = stubExecutor({
      stdout: '',
      stderr: 'budget exhausted',
      exitCode: 2,
      durationMs: 60,
    })
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('exit_error')
    if (out.kind === 'exit_error') {
      expect(out.exitCode).toBe(2)
    }
  })
})

/* ------------------------------------------------------------------ */
/* invokeClaude — existing behaviors (no regression)                   */
/* ------------------------------------------------------------------ */

describe('invokeClaude — existing behaviors (no regression)', () => {
  it('does not allow shell injection via prompt — passes raw string as argv', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '{"decision":"keep","confidence":1,"reason":"r"}' }, calls)
    const malicious = '"; rm -rf / # $(whoami)'
    await invokeClaude(malicious, SCHEMA, { executor: ex })
    expect(calls[0].args[0]).toBe('-p')
    expect(calls[0].args[1]).toBe(malicious)
  })

  it('scrubs Anthropic-bound API keys from subprocess env (A5: never bill against API credits)', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '{"decision":"keep","confidence":1,"reason":"r"}' }, calls)
    process.env.ANTHROPIC_API_KEY = 'leak-me'
    process.env.CLAUDE_API_KEY = 'leak-me-two'
    process.env.ANTHROPIC_AUTH_TOKEN = 'leak-me-three'
    try {
      await invokeClaude('p', SCHEMA, { executor: ex })
      const env = calls[0].opts.env
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.CLAUDE_API_KEY).toBeUndefined()
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
      // Note: full env (incl. CORTEX_API_KEY for the MCP server bootstrap) is
      // intentionally passed — see comment in src/consumer/claude.ts. macOS
      // Keychain access via securityd needs the session vars.
    } finally {
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.CLAUDE_API_KEY
      delete process.env.ANTHROPIC_AUTH_TOKEN
    }
  })

  it('uses default 120s timeout when not overridden', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '{"decision":"keep","confidence":1,"reason":"r"}' }, calls)
    await invokeClaude('p', SCHEMA, { executor: ex })
    expect(calls[0].opts.timeout).toBe(120_000)
  })

  it('honors custom timeoutMs', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '{"decision":"keep","confidence":1,"reason":"r"}' }, calls)
    await invokeClaude('p', SCHEMA, { executor: ex, timeoutMs: 7_000 })
    expect(calls[0].opts.timeout).toBe(7_000)
  })

  it('returns kind:ok with parsed value on clean JSON', async () => {
    const ex = stubExecutor({
      stdout: '{"decision":"keep","confidence":0.9,"reason":"r"}',
      durationMs: 42,
    })
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') {
      expect(out.value).toEqual({ decision: 'keep', confidence: 0.9, reason: 'r' })
      expect(out.durationMs).toBe(42)
      expect(out.exitCode).toBe(0)
      expect(out.stdoutFirst200).toContain('"decision"')
    }
  })

  it('extracts JSON wrapped in prose', async () => {
    const ex = stubExecutor({
      stdout: 'prefix text {"decision":"keep","confidence":0.9,"reason":"r"} suffix',
    })
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('ok')
  })

  it('returns kind:parse_error when stdout has NO JSON object', async () => {
    const ex = stubExecutor({ stdout: 'Sorry, I cannot help.' })
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('parse_error')
    if (out.kind === 'parse_error') {
      expect(out.reason).toContain('no_json_object_in_stdout')
    }
  })

  it('returns kind:parse_error when JSON is malformed', async () => {
    const ex = stubExecutor({ stdout: 'output: {not valid json}' })
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('parse_error')
    if (out.kind === 'parse_error') {
      expect(out.reason).toMatch(/json_parse_failed|no_json_object_in_stdout/)
    }
  })

  it('returns kind:parse_error when JSON fails Zod validation', async () => {
    const ex = stubExecutor({ stdout: '{"decision":"YES","confidence":"high","reason":1}' })
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('parse_error')
    if (out.kind === 'parse_error') {
      expect(out.reason).toMatch(/schema_failed/)
    }
  })

  it('returns kind:exit_error on non-zero exit, redacting stderr', async () => {
    const ex = stubExecutor({
      stdout: '',
      stderr: 'auth failed: Bearer abc123def_secret',
      exitCode: 1,
      durationMs: 80,
    })
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('exit_error')
    if (out.kind === 'exit_error') {
      expect(out.exitCode).toBe(1)
      expect(out.stderrFirst200).toContain('[REDACTED]')
      expect(out.stderrFirst200).not.toContain('abc123def_secret')
      expect(out.durationMs).toBe(80)
    }
  })

  it('returns kind:timeout when executor reports killed=true', async () => {
    const ex = stubExecutor({ killed: true, exitCode: 1, durationMs: 120_000 })
    const out = await invokeClaude('p', SCHEMA, { executor: ex })
    expect(out.kind).toBe('timeout')
    if (out.kind === 'timeout') {
      expect(out.durationMs).toBe(120_000)
    }
  })

  it('does NOT throw on parse failure — returns typed outcome instead', async () => {
    const ex = stubExecutor({ stdout: 'garbage' })
    await expect(invokeClaude('p', SCHEMA, { executor: ex })).resolves.toBeDefined()
  })

  it('does NOT retry — invokes executor exactly once even on parse failure', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: 'garbage' }, calls)
    await invokeClaude('p', SCHEMA, { executor: ex })
    expect(calls).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* assertClaudeOnPath                                                  */
/* ------------------------------------------------------------------ */

describe('assertClaudeOnPath', () => {
  it('resolves when `which claude` exits 0 with output', async () => {
    const ex = stubExecutor({ stdout: '/usr/local/bin/claude\n', exitCode: 0 })
    await expect(assertClaudeOnPath(ex)).resolves.toBeUndefined()
  })

  it('throws clear error when `which claude` exits non-zero', async () => {
    const ex = stubExecutor({ stdout: '', exitCode: 1 })
    await expect(assertClaudeOnPath(ex)).rejects.toThrow(/claude CLI not found on PATH/)
  })

  it('throws when `which claude` exits 0 but stdout is empty', async () => {
    const ex = stubExecutor({ stdout: '   \n', exitCode: 0 })
    await expect(assertClaudeOnPath(ex)).rejects.toThrow(/claude CLI not found on PATH/)
  })

  it('uses argv form for `which claude` (no shell)', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '/usr/local/bin/claude\n', exitCode: 0 }, calls)
    await assertClaudeOnPath(ex)
    expect(calls[0].cmd).toBe('which')
    expect(calls[0].args).toEqual(['claude'])
  })
})

/* ------------------------------------------------------------------ */
/* defaultExecutor — exists and is a function                          */
/* ------------------------------------------------------------------ */

describe('defaultExecutor', () => {
  it('is exported as a function', () => {
    expect(typeof defaultExecutor).toBe('function')
  })
})

/* ------------------------------------------------------------------ */
/* Static source guards (defense in depth)                             */
/* ------------------------------------------------------------------ */

describe('source-file invariants (claude.ts)', () => {
  let src: string
  beforeAll(async () => {
    const { readFile } = await import('node:fs/promises')
    src = await readFile(require.resolve('../src/consumer/claude'), 'utf8')
  })

  it('uses execFile, never spawn-with-shell', () => {
    expect(src).toMatch(/execFile\b/)
    expect(src).not.toMatch(/shell:\s*true/)
  })

  it('does NOT call child_process.exec (the shell-using variant)', () => {
    // Match a bare `exec(` with optional whitespace, but NOT `execFile(`.
    expect(src).not.toMatch(/[^a-zA-Z]exec\s*\(/)
  })

  it('does NOT reference any ANTHROPIC / OPENAI API key env var (Anthropic billing must not leak)', () => {
    // Post-lx4: CORTEX_API_KEY IS referenced because the MCP config tmpfile
    // needs to set it in the spawned cortex-tools env. The intent of this
    // guard — "never accidentally bill against Anthropic API" — is preserved
    // by keeping ANTHROPIC_API_KEY / OPENAI_API_KEY out of the source.
    expect(src).not.toMatch(/OPENAI_API_KEY/)
    // ANTHROPIC_API_KEY appears ONLY in the scrubAnthropicKeys helper that
    // deletes it. There it must literally appear so we have to allow exactly
    // the `delete out.ANTHROPIC_API_KEY` form. Defense: ensure no other
    // surface (URL, header, args) references it.
    const lines = src.split('\n')
    const offending = lines.filter(
      (l) =>
        l.includes('ANTHROPIC_API_KEY') &&
        !l.includes('delete out.ANTHROPIC_API_KEY') &&
        !l.match(/^\s*\*/) && // doc-comment
        !l.match(/^\s*\/\//), // line comment
    )
    expect(offending).toEqual([])
  })

  it('writes the MCP config tmpfile via fs (lx4 Task 3 — node:fs is intentional)', () => {
    // The original guard (no fs imports) was relaxed by lx4 Task 3: claude.ts
    // now writes a temporary MCP config JSON before spawning the subprocess.
    // We pin the new posture: fs imports are allowed but only for the tmpfile
    // (no readFileSync of arbitrary user paths).
    expect(src).toMatch(/from\s+['"]node:fs['"]|from\s+['"]node:fs\/promises['"]/)
    // The fs surface is restricted to writing a temp config + unlinking it —
    // assert the tmpfile path uses os.tmpdir() so it lives in the per-user
    // ephemeral directory (T-lx4-01).
    expect(src).toMatch(/tmpdir\(/)
  })
})
