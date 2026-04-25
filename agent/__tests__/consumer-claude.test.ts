/**
 * `claude -p` wrapper tests — Phase 7 Plan 01, Task 1.
 *
 * Tests use the executor-injection seam (no real subprocess spawned). All
 * <behavior> bullets from the plan are covered:
 *   - argv form invocation (no shell).
 *   - env allowlist (PATH + HOME only).
 *   - 120s default timeout, custom override honored.
 *   - JSON regex-extract on stdout, Zod-validated, returned as kind:'ok'.
 *   - Malformed stdout / failed Zod / non-zero exit / timeout — all return
 *     typed kinds without retry.
 *   - stderr redaction for Bearer tokens and sk-* secrets.
 *   - assertClaudeOnPath helper.
 *
 * Plan's anti-pattern guards verified by source-text grep at the bottom
 * of this file (test #last) — defense in depth against future edits that
 * might introduce shell:true / exec / fs reads.
 */

import { z } from 'zod'
import {
  invokeClaude,
  defaultExecutor,
  assertClaudeOnPath,
  extractFirstJsonObject,
  redactAndSlice,
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

/* ------------------------------------------------------------------ */
/* extractFirstJsonObject                                             */
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
/* invokeClaude                                                        */
/* ------------------------------------------------------------------ */

describe('invokeClaude', () => {
  it('invokes claude with argv form (no shell), prompt as single arg', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '{"decision":"keep","confidence":0.9,"reason":"r"}' }, calls)
    await invokeClaude('hello world', SCHEMA, { executor: ex })
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('claude')
    expect(calls[0].args).toEqual(['-p', 'hello world'])
  })

  it('does not allow shell injection via prompt — passes raw string as argv', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '{"decision":"keep","confidence":1,"reason":"r"}' }, calls)
    const malicious = '"; rm -rf / # $(whoami)'
    await invokeClaude(malicious, SCHEMA, { executor: ex })
    expect(calls[0].args).toEqual(['-p', malicious])
  })

  it('allowlists ONLY PATH and HOME — leaks no secrets to subprocess env', async () => {
    const calls: CapturedCall[] = []
    const ex = stubExecutor({ stdout: '{"decision":"keep","confidence":1,"reason":"r"}' }, calls)
    process.env.SECRET_FOR_TEST = 'leak-me'
    process.env.CORTEX_API_KEY = 'leak-me-too'
    process.env.ANTHROPIC_API_KEY = 'leak-me-three'
    try {
      await invokeClaude('p', SCHEMA, { executor: ex })
      const env = calls[0].opts.env
      expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH'])
      expect(env.SECRET_FOR_TEST).toBeUndefined()
      expect(env.CORTEX_API_KEY).toBeUndefined()
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    } finally {
      delete process.env.SECRET_FOR_TEST
      delete process.env.CORTEX_API_KEY
      delete process.env.ANTHROPIC_API_KEY
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
      expect(out.reason).toMatch(/json_parse_failed/)
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
  // These tests pin invariants by reading the source file directly. A future
  // refactor that introduces { shell: true } or `exec(...)` will fail loudly.
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

  it('does NOT reference any API key env var', () => {
    expect(src).not.toMatch(/ANTHROPIC_API_KEY/)
    expect(src).not.toMatch(/OPENAI_API_KEY/)
    expect(src).not.toMatch(/CORTEX_API_KEY/)
  })

  it('does NOT import from fs / node:fs / node:fs/promises', () => {
    expect(src).not.toMatch(/from\s+['"]fs['"]/)
    expect(src).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(src).not.toMatch(/from\s+['"]node:fs\/promises['"]/)
  })
})
