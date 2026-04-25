/**
 * agent/src/http/client.ts unit tests
 *
 * Validates the daemon's HTTP client (Phase 6 Plan 01, Task 2).
 * Per CONTEXT decisions:
 * - Native fetch (no axios/undici/node-fetch dep)
 * - Authorization: Bearer ${CORTEX_API_KEY} on every call
 * - Exponential backoff retry: base 1s, cap 30s, max 5 attempts
 * - Retry only 5xx, 429, network errors. NEVER retry 4xx.
 * - Terminal failure: emit Langfuse warning trace + return { kind: 'skip' } (no throw).
 *
 * Tests do not hit the network — globalThis.fetch is replaced via jest.spyOn.
 */

import { postIngest, postHeartbeat } from '../src/http/client'
import type { IngestRequest } from '../src/http/types'

// Minimal Langfuse stub — only the .trace() method is exercised by the client's
// terminal-skip path. Cast through `unknown` so we don't have to satisfy the full
// Langfuse interface in unit tests.
type LangfuseStub = { trace: jest.Mock }
const makeLfStub = (): LangfuseStub => ({ trace: jest.fn() })

// Helper: build a Response object that fetch can return.
const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const emptyResponse = (status: number): Response => new Response(null, { status })

// Standard payload for ingest tests
const samplePayload: IngestRequest = {
  source: 'downloads',
  content_hash: 'sha256_test_hash',
  filename: 'test.pdf',
}

describe('agent/src/http/client', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    process.env.CORTEX_API_KEY = 'test-secret'
    process.env.CORTEX_API_URL = 'https://x.example.com'
    jest.useFakeTimers()
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(jest.fn())
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    delete process.env.CORTEX_API_KEY
    delete process.env.CORTEX_API_URL
  })

  it('Test 1: sends Authorization: Bearer <CORTEX_API_KEY> and JSON content-type', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: 'i_1', deduped: false }))

    await postIngest(samplePayload)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-secret')
    expect(headers['Content-Type']).toBe('application/json')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify(samplePayload))
  })

  it('Test 2: posts to <CORTEX_API_URL>/api/ingest exactly', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: 'i_url', deduped: false }))

    await postIngest(samplePayload)

    expect(fetchSpy.mock.calls[0][0]).toBe('https://x.example.com/api/ingest')
  })

  it('Test 3: 200 success returns { kind: success, id, deduped: false } with no retries', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: 'i_new', deduped: false }))

    const out = await postIngest(samplePayload)

    expect(out).toEqual({ kind: 'success', id: 'i_new', deduped: false })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('Test 4: 200 dedup returns { kind: success, deduped: true } with no retries', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: 'i_dup', deduped: true }))

    const out = await postIngest(samplePayload)

    expect(out).toEqual({ kind: 'success', id: 'i_dup', deduped: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('Test 5: 4xx is NEVER retried — returns { kind: skip, reason: client_error, status }', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(400, { error: 'validation_failed' }))

    const out = await postIngest(samplePayload)

    expect(out).toEqual({ kind: 'skip', reason: 'client_error', status: 400 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('Test 6: 5xx retries up to MAX_ATTEMPTS — fifth attempt succeeds', async () => {
    // Four 500s then one 200 — fetch should be called 5 times total.
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(500, { error: 'oops' }))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'oops' }))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'oops' }))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'oops' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'i_late', deduped: false }))

    const promise = postIngest(samplePayload)
    // Run timers to flush all pending sleeps. The client awaits fetch then awaits
    // sleep — runAllTimersAsync resolves both alternately.
    await jest.runAllTimersAsync()
    const out = await promise

    expect(out).toEqual({ kind: 'success', id: 'i_late', deduped: false })
    expect(fetchSpy).toHaveBeenCalledTimes(5)
  })

  it('Test 7: 5xx exhaustion returns { kind: skip, reason: retries_exhausted } and emits Langfuse warning', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(500, { error: 'oops' }))
    const lf = makeLfStub()

    const promise = postIngest(samplePayload, { langfuse: lf as unknown as Parameters<typeof postIngest>[1] extends { langfuse?: infer L } | undefined ? L : never })
    await jest.runAllTimersAsync()
    const out = await promise

    expect(out.kind).toBe('skip')
    if (out.kind === 'skip') {
      expect(out.reason).toBe('retries_exhausted')
      expect(out.status).toBe(500)
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5)
    expect(lf.trace).toHaveBeenCalledTimes(1)
    const traceArg = lf.trace.mock.calls[0][0] as { name: string; metadata: Record<string, unknown> }
    expect(traceArg.name).toBe('http_client_terminal_skip')
    expect(traceArg.metadata.content_hash).toBe('sha256_test_hash')
    expect(traceArg.metadata.source).toBe('downloads')
    expect(traceArg.metadata.attempts).toBe(5)
    expect(traceArg.metadata.last_status).toBe(500)
  })

  it('Test 8: network error (TypeError fetch failed) retries up to MAX_ATTEMPTS then emits Langfuse warning', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'))
    const lf = makeLfStub()

    const promise = postIngest(samplePayload, { langfuse: lf as unknown as Parameters<typeof postIngest>[1] extends { langfuse?: infer L } | undefined ? L : never })
    await jest.runAllTimersAsync()
    const out = await promise

    expect(out.kind).toBe('skip')
    if (out.kind === 'skip') {
      expect(out.reason).toBe('retries_exhausted')
      expect(out.error).toContain('fetch failed')
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5)
    expect(lf.trace).toHaveBeenCalledTimes(1)
    const traceArg = lf.trace.mock.calls[0][0] as { name: string; metadata: Record<string, unknown> }
    expect(traceArg.name).toBe('http_client_terminal_skip')
    expect(traceArg.metadata.attempts).toBe(5)
  })

  it('Test 9: 429 retries until success (transient rate limit)', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate' }))
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate' }))
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate' }))
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'i_429', deduped: false }))

    const promise = postIngest(samplePayload)
    await jest.runAllTimersAsync()
    const out = await promise

    expect(out).toEqual({ kind: 'success', id: 'i_429', deduped: false })
    expect(fetchSpy).toHaveBeenCalledTimes(5)
  })

  it('Test 10: backoff sequence is bounded by base*2^(n-1) capped at MAX_DELAY_MS', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(500, { error: 'oops' }))
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout')

    const promise = postIngest(samplePayload)
    await jest.runAllTimersAsync()
    await promise

    // After 5 attempts there are 4 sleeps between them. Each sleep delay must be
    // <= 30000 (cap) and follow the doubling pattern up to the cap.
    const delays = setTimeoutSpy.mock.calls
      .map((c) => c[1] as number)
      .filter((d) => typeof d === 'number')
    expect(delays.length).toBeGreaterThanOrEqual(4)
    // The first 4 backoff sleeps should be in the documented sequence (no jitter
    // in the reference implementation): 1000, 2000, 4000, 8000.
    expect(delays[0]).toBe(1000)
    expect(delays[1]).toBe(2000)
    expect(delays[2]).toBe(4000)
    expect(delays[3]).toBe(8000)
    // Every delay must be <= cap.
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(30_000)
    }
  })

  it('Test 11: throws synchronously when CORTEX_API_KEY is unset; fetch is never called', async () => {
    delete process.env.CORTEX_API_KEY

    await expect(postIngest(samplePayload)).rejects.toThrow(/CORTEX_API_KEY/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('Test 12: throws synchronously when CORTEX_API_URL is unset; fetch is never called', async () => {
    delete process.env.CORTEX_API_URL

    await expect(postIngest(samplePayload)).rejects.toThrow(/CORTEX_API_URL/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ---- Heartbeat path ----
  it('Test 13: postHeartbeat() posts { heartbeat: true }, expects 204, returns { kind: heartbeat_ack }', async () => {
    fetchSpy.mockResolvedValueOnce(emptyResponse(204))

    const out = await postHeartbeat()

    expect(out).toEqual({ kind: 'heartbeat_ack' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://x.example.com/api/ingest')
    expect((init as RequestInit).body).toBe(JSON.stringify({ heartbeat: true }))
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-secret')
  })
})
