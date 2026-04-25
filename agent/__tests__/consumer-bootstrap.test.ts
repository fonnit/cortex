/**
 * Consumer entry point unit tests — Phase 7 Plan 02, Task 3.
 *
 * Validates:
 *   - validateConsumerEnv reports missing CORTEX_API_URL / CORTEX_API_KEY /
 *     LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY.
 *   - bootstrapConsumer with missing env → console.error fatal +
 *     consumer_bootstrap_fatal Langfuse trace + process.exit(1).
 *   - bootstrapConsumer with all env present BUT claude not on PATH →
 *     consumer_bootstrap_fatal trace with reason:claude_cli_missing + exit(1).
 *   - bootstrapConsumer happy path: Stage 1 + Stage 2 workers both start
 *     exactly once, with the langfuse instance passed.
 *   - SIGTERM handler triggers stop() on both workers + flushes Langfuse +
 *     exits 0.
 *   - consumer_start trace emitted on successful boot.
 *   - Plist tests (regex-based, no plist parser dep): file exists, contains
 *     KeepAlive, ThrottleInterval, separate logs, NO DATABASE_URL, NO
 *     ANTHROPIC_API_KEY / OPENAI_API_KEY.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type Langfuse from 'langfuse'

// Mock langfuse at module-load — bootstrapConsumer instantiates a Langfuse
// when none is injected (the missing-env path), so we need a constructor stub.
jest.mock('langfuse', () => {
  return jest.fn().mockImplementation(() => ({
    trace: jest.fn(),
    flushAsync: jest.fn().mockResolvedValue(undefined),
  }))
})

import {
  validateConsumerEnv,
  bootstrapConsumer,
} from '../src/consumer/index'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.CORTEX_API_URL
  delete process.env.CORTEX_API_KEY
  delete process.env.LANGFUSE_PUBLIC_KEY
  delete process.env.LANGFUSE_SECRET_KEY
})

afterAll(() => {
  process.env = { ...ORIGINAL_ENV }
})

/* ────────────────────────────────────────────────────────────────────── */
/* validateConsumerEnv                                                     */
/* ────────────────────────────────────────────────────────────────────── */

describe('validateConsumerEnv', () => {
  it('Test 1a: reports all four missing when env is empty', () => {
    const r = validateConsumerEnv()
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(
      expect.arrayContaining([
        'CORTEX_API_URL',
        'CORTEX_API_KEY',
        'LANGFUSE_PUBLIC_KEY',
        'LANGFUSE_SECRET_KEY',
      ]),
    )
  })

  it('Test 1b: reports CORTEX_API_KEY missing when only URL is set', () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    process.env.LANGFUSE_SECRET_KEY = 'sk'
    const r = validateConsumerEnv()
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['CORTEX_API_KEY'])
  })

  it('Test 1c: reports LANGFUSE_SECRET_KEY missing when only public is set', () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    process.env.CORTEX_API_KEY = 'k'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    const r = validateConsumerEnv()
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['LANGFUSE_SECRET_KEY'])
  })

  it('Test 1d: returns ok=true when all four are present', () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    process.env.CORTEX_API_KEY = 'k'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    process.env.LANGFUSE_SECRET_KEY = 'sk'
    const r = validateConsumerEnv()
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
  })
})

/* ────────────────────────────────────────────────────────────────────── */
/* bootstrapConsumer — missing env path                                   */
/* ────────────────────────────────────────────────────────────────────── */

describe('bootstrapConsumer — env validation', () => {
  it('Test 2: missing CORTEX_API_KEY → console.error fatal + process.exit(1)', async () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    process.env.LANGFUSE_SECRET_KEY = 'sk'

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number): never => {
        throw new Error(`__exit_${code}__`)
      }) as never)
    const trace = jest.fn()
    const flushAsync = jest.fn().mockResolvedValue(undefined)
    const lf = { trace, flushAsync } as unknown as Langfuse

    try {
      await bootstrapConsumer({ langfuse: lf })
    } catch (e) {
      expect((e as Error).message).toBe('__exit_1__')
    }

    expect(exitSpy).toHaveBeenCalledWith(1)
    const fatalMsg = errSpy.mock.calls.flat().join(' ')
    expect(fatalMsg).toMatch(/CORTEX_API_KEY/)
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'consumer_bootstrap_fatal',
        metadata: expect.objectContaining({
          reason: 'missing_env',
          missing: expect.arrayContaining(['CORTEX_API_KEY']),
        }),
      }),
    )

    errSpy.mockRestore()
    exitSpy.mockRestore()
  })
})

/* ────────────────────────────────────────────────────────────────────── */
/* bootstrapConsumer — claude-not-on-PATH path                            */
/* ────────────────────────────────────────────────────────────────────── */

describe('bootstrapConsumer — claude on PATH', () => {
  it('Test 3: assertClaudeOnPath rejects → consumer_bootstrap_fatal claude_cli_missing + exit(1)', async () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    process.env.CORTEX_API_KEY = 'k'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    process.env.LANGFUSE_SECRET_KEY = 'sk'

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number): never => {
        throw new Error(`__exit_${code}__`)
      }) as never)
    const trace = jest.fn()
    const flushAsync = jest.fn().mockResolvedValue(undefined)
    const lf = { trace, flushAsync } as unknown as Langfuse

    const assertClaudeOnPathImpl = jest.fn(async () => {
      throw new Error('claude CLI not found on PATH — install Claude Code or run `claude login`')
    })

    try {
      await bootstrapConsumer({
        langfuse: lf,
        assertClaudeOnPathImpl: assertClaudeOnPathImpl as never,
      })
    } catch (e) {
      expect((e as Error).message).toBe('__exit_1__')
    }

    expect(exitSpy).toHaveBeenCalledWith(1)
    const fatalMsg = errSpy.mock.calls.flat().join(' ')
    expect(fatalMsg).toMatch(/claude/)
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'consumer_bootstrap_fatal',
        metadata: expect.objectContaining({
          reason: 'claude_cli_missing',
        }),
      }),
    )

    errSpy.mockRestore()
    exitSpy.mockRestore()
  })
})

/* ────────────────────────────────────────────────────────────────────── */
/* bootstrapConsumer — happy path                                         */
/* ────────────────────────────────────────────────────────────────────── */

describe('bootstrapConsumer — happy path', () => {
  let onSpy: jest.SpyInstance

  beforeEach(() => {
    // Stub process.on so happy-path tests don't actually install global
    // SIGTERM/SIGINT/uncaughtException listeners that survive between tests
    // and cause "Jest did not exit" warnings on real signals after the run.
    onSpy = jest.spyOn(process, 'on').mockImplementation((() => process) as never)
  })

  afterEach(() => {
    onSpy.mockRestore()
  })

  it('Test 4: Stage 1 + Stage 2 workers each started exactly once with langfuse', async () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    process.env.CORTEX_API_KEY = 'k'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    process.env.LANGFUSE_SECRET_KEY = 'sk'

    const trace = jest.fn()
    const flushAsync = jest.fn().mockResolvedValue(undefined)
    const lf = { trace, flushAsync } as unknown as Langfuse

    const stage1Stop = jest.fn().mockResolvedValue(undefined)
    const stage2Stop = jest.fn().mockResolvedValue(undefined)
    const runStage1 = jest.fn((deps: { langfuse: unknown }) => {
      void deps
      return { stop: stage1Stop }
    })
    const runStage2 = jest.fn((deps: { langfuse: unknown }) => {
      void deps
      return { stop: stage2Stop }
    })
    const assertClaudeOnPathImpl = jest.fn(async () => {})

    await bootstrapConsumer({
      langfuse: lf,
      runStage1: runStage1 as never,
      runStage2: runStage2 as never,
      assertClaudeOnPathImpl: assertClaudeOnPathImpl as never,
    })

    expect(runStage1).toHaveBeenCalledTimes(1)
    expect(runStage2).toHaveBeenCalledTimes(1)
    // Each receives the langfuse instance.
    expect(runStage1.mock.calls[0]![0]).toEqual(expect.objectContaining({ langfuse: lf }))
    expect(runStage2.mock.calls[0]![0]).toEqual(expect.objectContaining({ langfuse: lf }))
  })

  it('Test 6: consumer_start trace emitted on successful boot', async () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    process.env.CORTEX_API_KEY = 'k'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    process.env.LANGFUSE_SECRET_KEY = 'sk'

    const trace = jest.fn()
    const flushAsync = jest.fn().mockResolvedValue(undefined)
    const lf = { trace, flushAsync } as unknown as Langfuse

    await bootstrapConsumer({
      langfuse: lf,
      runStage1: (() => ({ stop: jest.fn().mockResolvedValue(undefined) })) as never,
      runStage2: (() => ({ stop: jest.fn().mockResolvedValue(undefined) })) as never,
      assertClaudeOnPathImpl: (async () => {}) as never,
    })

    const traceNames = trace.mock.calls.map((c) => (c[0] as { name: string }).name)
    expect(traceNames).toContain('consumer_start')
  })
})

/* ────────────────────────────────────────────────────────────────────── */
/* SIGTERM handler                                                         */
/* ────────────────────────────────────────────────────────────────────── */

describe('bootstrapConsumer — signal handlers', () => {
  it('Test 5: SIGTERM triggers stop() on both workers + flushAsync + exit(0)', async () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    process.env.CORTEX_API_KEY = 'k'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    process.env.LANGFUSE_SECRET_KEY = 'sk'

    const trace = jest.fn()
    const flushAsync = jest.fn().mockResolvedValue(undefined)
    const lf = { trace, flushAsync } as unknown as Langfuse

    const stage1Stop = jest.fn().mockResolvedValue(undefined)
    const stage2Stop = jest.fn().mockResolvedValue(undefined)

    // Mock process.exit to a no-op so the async shutdown chain inside the
    // signal handler doesn't actually exit the test runner. We DO NOT throw
    // here because the signal-handler chain wraps process.exit in a try/finally
    // and lets a thrown error escape into an unhandled-rejection killing jest.
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number): never => undefined as never) as never)

    // Capture process.on listeners so we can fire SIGTERM manually.
    const sigtermHandlers: Array<() => void> = []
    const onSpy = jest.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: () => void,
    ): NodeJS.Process => {
      if (event === 'SIGTERM') sigtermHandlers.push(handler)
      return process
    }) as never)

    await bootstrapConsumer({
      langfuse: lf,
      runStage1: (() => ({ stop: stage1Stop })) as never,
      runStage2: (() => ({ stop: stage2Stop })) as never,
      assertClaudeOnPathImpl: (async () => {}) as never,
    })

    expect(sigtermHandlers.length).toBeGreaterThan(0)

    // Fire SIGTERM and let the async shutdown promise resolve.
    sigtermHandlers[0]!()
    // Give the async chain time to walk through stage1.stop / stage2.stop /
    // langfuse.flushAsync before exit() is called.
    for (let i = 0; i < 20; i++) await Promise.resolve()

    expect(stage1Stop).toHaveBeenCalled()
    expect(stage2Stop).toHaveBeenCalled()
    expect(flushAsync).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(0)

    onSpy.mockRestore()
    exitSpy.mockRestore()
  })
})

/* ────────────────────────────────────────────────────────────────────── */
/* launchd plist                                                            */
/* ────────────────────────────────────────────────────────────────────── */

describe('com.cortex.consumer.plist', () => {
  // Resolve relative to this test file. Jest's cwd is the project root, but
  // we use __dirname so the path is robust to invocation context.
  const PLIST_PATH = path.resolve(__dirname, '..', 'launchd', 'com.cortex.consumer.plist')

  it('plist file exists and is readable', () => {
    expect(fs.existsSync(PLIST_PATH)).toBe(true)
  })

  it('Label is com.cortex.consumer', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    expect(text).toMatch(/<key>Label<\/key>\s*<string>com\.cortex\.consumer<\/string>/)
  })

  it('KeepAlive is true (auto-restart on crash)', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    expect(text).toMatch(/<key>KeepAlive<\/key>\s*<true\s*\/>/)
  })

  it('ThrottleInterval is 10s (back off on persistent failures)', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    expect(text).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/)
  })

  it('ProgramArguments invokes node + tsx + agent/src/consumer/index.ts', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    expect(text).toContain('agent/src/consumer/index.ts')
    expect(text).toMatch(/--import=tsx/)
  })

  it('StandardOutPath / StandardErrorPath separate from daemon (cortex-consumer)', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    // Both stdout and stderr paths should reference "consumer" (not "daemon").
    const standardOut = text.match(/<key>StandardOutPath<\/key>\s*<string>([^<]+)<\/string>/)
    const standardErr = text.match(/<key>StandardErrorPath<\/key>\s*<string>([^<]+)<\/string>/)
    expect(standardOut).not.toBeNull()
    expect(standardErr).not.toBeNull()
    expect(standardOut![1]).toContain('consumer')
    expect(standardErr![1]).toContain('consumer')
    expect(standardOut![1]).not.toContain('daemon')
    expect(standardErr![1]).not.toContain('daemon')
  })

  it('EnvironmentVariables contains required keys', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    expect(text).toContain('<key>NODE_ENV</key>')
    expect(text).toContain('<key>HOME</key>')
    expect(text).toContain('<key>PATH</key>')
    expect(text).toContain('<key>CORTEX_API_URL</key>')
    expect(text).toContain('<key>CORTEX_API_KEY</key>')
    expect(text).toContain('<key>LANGFUSE_PUBLIC_KEY</key>')
    expect(text).toContain('<key>LANGFUSE_SECRET_KEY</key>')
  })

  it('T-07-15: EnvironmentVariables does NOT contain DATABASE_URL', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    expect(text).not.toContain('DATABASE_URL')
  })

  it('Does NOT contain ANTHROPIC_API_KEY (claude CLI uses its own credential store)', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    expect(text).not.toContain('ANTHROPIC_API_KEY')
  })

  it('Does NOT contain OPENAI_API_KEY', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    expect(text).not.toContain('OPENAI_API_KEY')
  })

  it('PATH puts ~/.local/bin first so working node v22.12.0 resolves before broken system node', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    const pathMatch = text.match(/<key>PATH<\/key>\s*<string>([^<]+)<\/string>/)
    expect(pathMatch).not.toBeNull()
    const dirs = pathMatch![1].split(':')
    expect(dirs[0]).toBe('/Users/dfonnegrag/.local/bin')
  })

  it('plist is valid XML structure (top-level <plist> element with <dict>)', () => {
    const text = fs.readFileSync(PLIST_PATH, 'utf8')
    expect(text).toMatch(/<\?xml version="1\.0"/)
    expect(text).toMatch(/<plist version="1\.0">/)
    expect(text).toMatch(/<dict>[\s\S]+<\/dict>/)
    expect(text).toMatch(/<\/plist>/)
  })
})
