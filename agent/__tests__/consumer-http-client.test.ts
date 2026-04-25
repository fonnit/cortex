/**
 * agent/src/http/client.ts — Phase 7 Plan 01, Task 3 unit tests.
 *
 * Validates the new consumer-side helpers added on top of postIngest /
 * postHeartbeat:
 *   - getQueue(stage, limit) — auth, X-Trace-Id surfacing, retry semantics
 *   - postClassify(payload) — 409-no-retry override, retry on 5xx/429/network
 *   - getTaxonomyInternal() — throws on 4xx; throws with cause on retries
 *
 * Mirrors the scaffolding pattern from agent/__tests__/http-client.test.ts:
 * fetchSpy via jest.spyOn(globalThis, 'fetch'), fake timers for backoff,
 * env mutation per test.
 */

import { getQueue, postClassify, getTaxonomyInternal } from '../src/http/client'
import type { ClassifyRequest } from '../src/http/types'

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const emptyResponse = (status: number): Response => new Response(null, { status })

describe('agent/src/http/client (consumer helpers)', () => {
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

  /* ────────────────────────────────────────────────────────────────────── */
  /* getQueue                                                                */
  /* ────────────────────────────────────────────────────────────────────── */

  describe('getQueue', () => {
    it('GETs /api/queue with stage and limit query params + Bearer auth', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { items: [], reclaimed: 0 }, { 'X-Trace-Id': 't_1' }))

      await getQueue({ stage: 1, limit: 10 })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('https://x.example.com/api/queue?stage=1&limit=10')
      expect((init as RequestInit).method).toBe('GET')
      const headers = (init as RequestInit).headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-secret')
    })

    it('returns parsed items + reclaimed + X-Trace-Id on 200', async () => {
      const items = [
        {
          id: 'i_1',
          source: 'downloads',
          filename: 'a.pdf',
          mime_type: 'application/pdf',
          size_bytes: 100,
          content_hash: 'sha_1',
          source_metadata: null,
          file_path: '/Users/d/a.pdf',
        },
      ]
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { items, reclaimed: 2 }, { 'X-Trace-Id': 'trace-abc' }),
      )

      const out = await getQueue({ stage: 1, limit: 10 })

      expect(out).toEqual({ items, reclaimed: 2, traceId: 'trace-abc' })
    })

    it('surfaces traceId as null when X-Trace-Id header is absent', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { items: [], reclaimed: 0 }))

      const out = await getQueue({ stage: 2, limit: 2 })

      if ('traceId' in out) {
        expect(out.traceId).toBeNull()
      } else {
        throw new Error('expected QueueResponse, got skip')
      }
    })

    it('returns kind:skip client_error on 401 with NO retry', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(401, {}))

      const out = await getQueue({ stage: 1, limit: 10 })

      expect(out).toEqual({ kind: 'skip', reason: 'client_error', status: 401 })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('retries 5xx then succeeds', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(500, {}))
        .mockResolvedValueOnce(jsonResponse(500, {}))
        .mockResolvedValueOnce(jsonResponse(200, { items: [], reclaimed: 0 }))

      const promise = getQueue({ stage: 1, limit: 10 })
      await jest.runAllTimersAsync()
      const out = await promise

      if ('items' in out) {
        expect(out.items).toEqual([])
      } else {
        throw new Error('expected success')
      }
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it('returns kind:skip retries_exhausted after 5x 5xx', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(503, {}))

      const promise = getQueue({ stage: 1, limit: 10 })
      await jest.runAllTimersAsync()
      const out = await promise

      expect(out).toMatchObject({ kind: 'skip', reason: 'retries_exhausted', status: 503 })
      expect(fetchSpy).toHaveBeenCalledTimes(5)
    })

    it('throws synchronously when CORTEX_API_KEY is unset', async () => {
      delete process.env.CORTEX_API_KEY
      await expect(getQueue({ stage: 1, limit: 10 })).rejects.toThrow(/CORTEX_API_KEY/)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  /* ────────────────────────────────────────────────────────────────────── */
  /* postClassify                                                            */
  /* ────────────────────────────────────────────────────────────────────── */

  describe('postClassify', () => {
    const successPayload: ClassifyRequest = {
      item_id: 'i_1',
      stage: 1,
      outcome: 'success',
      decision: 'keep',
      confidence: 0.9,
      reason: 'looks like a statement',
    }

    it('POSTs /api/classify with Bearer auth + JSON body', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true, status: 'pending_stage2', retries: 0 }))

      await postClassify(successPayload)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('https://x.example.com/api/classify')
      expect((init as RequestInit).method).toBe('POST')
      const headers = (init as RequestInit).headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-secret')
      expect(headers['Content-Type']).toBe('application/json')
      expect((init as RequestInit).body).toBe(JSON.stringify(successPayload))
    })

    it('returns kind:ok with status + retries on 200', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { ok: true, status: 'pending_stage2', retries: 0 }),
      )

      const out = await postClassify(successPayload)

      expect(out).toEqual({ kind: 'ok', status: 'pending_stage2', retries: 0 })
    })

    it('returns kind:conflict on 409 — no retry, fetch called exactly once', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(409, { error: 'item_no_longer_claimed', current_status: 'changed' }),
      )

      const out = await postClassify(successPayload)

      expect(out).toEqual({ kind: 'conflict', currentStatus: 'changed' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('returns kind:conflict with currentStatus="unknown" if 409 body lacks current_status', async () => {
      fetchSpy.mockResolvedValueOnce(emptyResponse(409))

      const out = await postClassify(successPayload)

      expect(out).toEqual({ kind: 'conflict', currentStatus: 'unknown' })
    })

    it('retries 5xx,5xx,200 and returns kind:ok after 2 backoff sleeps', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(503, {}))
        .mockResolvedValueOnce(jsonResponse(503, {}))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, status: 'certain', retries: 0 }))

      const promise = postClassify(successPayload)
      await jest.runAllTimersAsync()
      const out = await promise

      expect(out).toEqual({ kind: 'ok', status: 'certain', retries: 0 })
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it('retries 429 up to MAX_ATTEMPTS then returns kind:skip retries_exhausted', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(429, {}))

      const promise = postClassify(successPayload)
      await jest.runAllTimersAsync()
      const out = await promise

      expect(out).toMatchObject({ kind: 'skip', reason: 'retries_exhausted', status: 429 })
      expect(fetchSpy).toHaveBeenCalledTimes(5)
    })

    it('returns kind:skip client_error on 400 — never retries', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(400, { error: 'validation_failed' }))

      const out = await postClassify(successPayload)

      expect(out).toEqual({ kind: 'skip', reason: 'client_error', status: 400 })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('returns kind:skip client_error on 404 — never retries (item_not_found)', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(404, { error: 'item_not_found' }))

      const out = await postClassify(successPayload)

      expect(out).toEqual({ kind: 'skip', reason: 'client_error', status: 404 })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('handles error-outcome payloads (Stage X failure)', async () => {
      const errorPayload: ClassifyRequest = {
        item_id: 'i_1',
        stage: 1,
        outcome: 'error',
        error_message: 'claude parse_error',
      }
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { ok: true, status: 'pending_stage1', retries: 1 }),
      )

      const out = await postClassify(errorPayload)

      expect(out).toEqual({ kind: 'ok', status: 'pending_stage1', retries: 1 })
      expect((fetchSpy.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify(errorPayload))
    })

    it('throws synchronously when CORTEX_API_KEY is unset', async () => {
      delete process.env.CORTEX_API_KEY
      await expect(postClassify(successPayload)).rejects.toThrow(/CORTEX_API_KEY/)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  /* ────────────────────────────────────────────────────────────────────── */
  /* getTaxonomyInternal                                                     */
  /* ────────────────────────────────────────────────────────────────────── */

  describe('getTaxonomyInternal', () => {
    it('GETs /api/taxonomy/internal with Bearer auth', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { type: ['receipt'], from: ['acme'], context: ['finance'] }),
      )

      await getTaxonomyInternal()

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('https://x.example.com/api/taxonomy/internal')
      expect((init as RequestInit).method).toBe('GET')
      const headers = (init as RequestInit).headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-secret')
    })

    it('returns the parsed body on 200', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { type: ['invoice'], from: ['acme'], context: ['finance'] }),
      )

      const out = await getTaxonomyInternal()

      expect(out).toEqual({ type: ['invoice'], from: ['acme'], context: ['finance'] })
    })

    it('throws on 401 — no retry', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(401, {}))

      await expect(getTaxonomyInternal()).rejects.toThrow(/taxonomy fetch failed: 401/)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('throws after retries exhausted on 5xx, with last status carried in cause', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(503, {}))

      // Attach the rejection handler synchronously to avoid the
      // PromiseRejectionHandledWarning that occurs when fake timers race
      // ahead of await expect(...).rejects.
      const promise = getTaxonomyInternal()
      const expectation = expect(promise).rejects.toThrow(/taxonomy fetch failed after 5 attempts/)
      await jest.runAllTimersAsync()
      await expectation
      expect(fetchSpy).toHaveBeenCalledTimes(5)
    })

    it('retries 5xx then succeeds', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(500, {}))
        .mockResolvedValueOnce(jsonResponse(200, { type: [], from: [], context: [] }))

      const promise = getTaxonomyInternal()
      await jest.runAllTimersAsync()
      const out = await promise

      expect(out).toEqual({ type: [], from: [], context: [] })
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('throws synchronously when CORTEX_API_KEY is unset', async () => {
      delete process.env.CORTEX_API_KEY
      await expect(getTaxonomyInternal()).rejects.toThrow(/CORTEX_API_KEY/)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
