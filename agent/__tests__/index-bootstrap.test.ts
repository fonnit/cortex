/**
 * agent/src/index.ts bootstrap unit tests — Phase 6 Plan 02 Task 6.
 *
 * Validates the startup-time contract of the daemon's main entry point:
 * - validateBootstrapEnv() reports missing CORTEX_API_URL / CORTEX_API_KEY.
 * - bootstrap() exits 1 + emits a `daemon_bootstrap_fatal` Langfuse trace
 *   when either env var is missing.
 *
 * The watcher / Gmail-poll loops require real OAuth and live network — those
 * are integration-tested in Phase 8. Here we only exercise the bootstrap
 * contract via DI of a stubbed Langfuse.
 */

import type Langfuse from 'langfuse'

// Stub the heavy / ESM-only transitive deps so the bootstrap module can load
// under jest's CommonJS+node moduleResolution. The bootstrap path under test
// (missing-env exit) never calls into these modules, so empty mocks suffice.
jest.mock('chokidar', () => ({ watch: jest.fn() }))
jest.mock('googleapis', () => ({ google: { gmail: jest.fn() } }))
jest.mock('keytar', () => ({
  getPassword: jest.fn(),
  setPassword: jest.fn(),
}))
jest.mock('langfuse', () => {
  return jest.fn().mockImplementation(() => ({
    trace: jest.fn(),
    flushAsync: jest.fn().mockResolvedValue(undefined),
  }))
})

import { validateBootstrapEnv, bootstrap } from '../src/index'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  // Restore env between tests so per-test mutation is isolated.
  process.env = { ...ORIGINAL_ENV }
  delete process.env.CORTEX_API_URL
  delete process.env.CORTEX_API_KEY
})

afterAll(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('agent/src/index — validateBootstrapEnv', () => {
  it('Test 1: reports CORTEX_API_KEY missing when only URL is set', () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    const r = validateBootstrapEnv()
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['CORTEX_API_KEY'])
  })

  it('Test 2: reports CORTEX_API_URL missing when only KEY is set', () => {
    process.env.CORTEX_API_KEY = 'k'
    const r = validateBootstrapEnv()
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['CORTEX_API_URL'])
  })

  it('Test 3: reports both missing when neither is set', () => {
    const r = validateBootstrapEnv()
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['CORTEX_API_URL', 'CORTEX_API_KEY'])
  })

  it('Test 4: returns ok=true when both are present', () => {
    process.env.CORTEX_API_URL = 'https://example.test'
    process.env.CORTEX_API_KEY = 'k'
    const r = validateBootstrapEnv()
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
  })
})

describe('agent/src/index — bootstrap', () => {
  it('Test 5: missing CORTEX_API_KEY → console.error fatal + process.exit(1)', async () => {
    process.env.CORTEX_API_URL = 'https://example.test'

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
      await bootstrap({ langfuse: lf })
    } catch (e) {
      expect((e as Error).message).toBe('__exit_1__')
    }

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errSpy).toHaveBeenCalled()
    const fatalMsg = errSpy.mock.calls.flat().join(' ')
    expect(fatalMsg).toMatch(/CORTEX_API_KEY/)

    errSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('Test 6: missing-env path emits a daemon_bootstrap_fatal Langfuse trace', async () => {
    // Both missing.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((_c?: number): never => {
        throw new Error('__exit__')
      }) as never)
    const trace = jest.fn()
    const flushAsync = jest.fn().mockResolvedValue(undefined)
    const lf = { trace, flushAsync } as unknown as Langfuse

    try {
      await bootstrap({ langfuse: lf })
    } catch {
      /* exit was thrown; the test continues to assert side effects */
    }

    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'daemon_bootstrap_fatal',
        metadata: expect.objectContaining({
          missing: ['CORTEX_API_URL', 'CORTEX_API_KEY'],
        }),
      }),
    )
    expect(flushAsync).toHaveBeenCalled()

    errSpy.mockRestore()
    exitSpy.mockRestore()
  })
})
