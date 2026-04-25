/**
 * POST /api/ingest API route tests
 *
 * Validates the ingest entry-point used by the future Mac daemon (Phase 6).
 * Per CONTEXT decisions:
 * - CORTEX_API_KEY shared-secret Bearer auth (empty 401 body on failure)
 * - SHA-256 dedup by content_hash; HTTP 200 with { id, deduped } either way
 * - New items written at status='pending_stage1' (QUEUE_STATUSES.PENDING_STAGE_1)
 * - X-Trace-Id response header on every return path
 */

// Mock Prisma before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))

// Mock Langfuse — return a stable trace.id so we can assert the X-Trace-Id header.
// Span and trace mocks are exposed via globalThis so individual tests can assert
// against them (e.g. "heartbeat path never opens a span").
const __langfuseSpanMock = { end: jest.fn() }
const __langfuseTraceMock = { id: 'trace_test_ingest', span: jest.fn(() => __langfuseSpanMock) }
const __langfuseFlushMock = jest.fn().mockResolvedValue(undefined)
const __langfuseTraceFactory = jest.fn(() => __langfuseTraceMock)
jest.mock('langfuse', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      trace: __langfuseTraceFactory,
      flushAsync: __langfuseFlushMock,
    })),
  }
})

import type { NextRequest } from 'next/server'
import { POST } from '../app/api/ingest/route'
import { prisma } from '../lib/prisma'

const mockFindUnique = prisma.item.findUnique as jest.MockedFunction<typeof prisma.item.findUnique>
const mockCreate = prisma.item.create as jest.MockedFunction<typeof prisma.item.create>

function makeRequest(opts: { body?: unknown; auth?: string | null } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.auth !== null) {
    headers.authorization = opts.auth ?? 'Bearer test-secret'
  }
  return new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }) as unknown as NextRequest
}

describe('POST /api/ingest', () => {
  beforeEach(() => {
    process.env.CORTEX_API_KEY = 'test-secret'
    jest.clearAllMocks()
  })

  it('Test 1: returns 401 with empty body when Authorization header is missing', async () => {
    const req = makeRequest({ auth: null, body: { source: 'downloads', content_hash: 'abc' } })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    // Auth runs first — DB never touched
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('Test 2: returns 401 with empty body when token is wrong', async () => {
    const req = makeRequest({ auth: 'Bearer wrong-token', body: { source: 'downloads', content_hash: 'abc' } })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('Test 3: returns 400 validation_failed when source is missing', async () => {
    const req = makeRequest({ body: { content_hash: 'abc' } })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('validation_failed')
    expect(Array.isArray(json.issues)).toBe(true)
  })

  it('Test 4: returns 400 validation_failed when source is not downloads or gmail', async () => {
    const req = makeRequest({ body: { source: 'unknown', content_hash: 'abc' } })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('validation_failed')
  })

  it('Test 5: returns 400 validation_failed when content_hash is missing', async () => {
    const req = makeRequest({ body: { source: 'downloads' } })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('validation_failed')
  })

  it('Test 6: returns 200 { id, deduped: false } when content_hash is new — creates Item with status=pending_stage1', async () => {
    mockFindUnique.mockResolvedValue(null as never)
    mockCreate.mockResolvedValue({ id: 'item_new_1' } as never)

    const req = makeRequest({
      body: {
        source: 'downloads',
        content_hash: 'sha256_new_hash',
        filename: 'invoice.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        file_path: '/Users/dan/Downloads/invoice.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ id: 'item_new_1', deduped: false })

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { content_hash: 'sha256_new_hash' } })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const createArg = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createArg.data.status).toBe('pending_stage1')
    expect(createArg.data.content_hash).toBe('sha256_new_hash')
    expect(createArg.data.source).toBe('downloads')
    expect(createArg.data.filename).toBe('invoice.pdf')
    expect(createArg.data.mime_type).toBe('application/pdf')
    expect(createArg.data.size_bytes).toBe(1024)
    // file_path lives inside source_metadata (no schema migration this phase)
    expect((createArg.data.source_metadata as Record<string, unknown>).file_path).toBe(
      '/Users/dan/Downloads/invoice.pdf',
    )
    // user_id pinned to single-operator owner
    expect(typeof createArg.data.user_id).toBe('string')
    expect((createArg.data.user_id as string).length).toBeGreaterThan(0)
  })

  it('Test 7: returns 200 { id: <existing>, deduped: true } when content_hash exists — does NOT call create', async () => {
    mockFindUnique.mockResolvedValue({ id: 'item_existing_xyz', content_hash: 'dup_hash' } as never)

    const req = makeRequest({
      body: { source: 'gmail', content_hash: 'dup_hash' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ id: 'item_existing_xyz', deduped: true })

    // CRITICAL — no second write on cache hit (verifier explicitly checks this)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('Test 8: response includes header X-Trace-Id with a non-empty value', async () => {
    mockFindUnique.mockResolvedValue(null as never)
    mockCreate.mockResolvedValue({ id: 'item_trace' } as never)

    const req = makeRequest({ body: { source: 'downloads', content_hash: 'h1' } })
    const res = await POST(req)
    const traceId = res.headers.get('X-Trace-Id')
    expect(traceId).toBeTruthy()
    expect(typeof traceId).toBe('string')
    expect((traceId as string).length).toBeGreaterThan(0)
  })

  it('Test 9: returns 500 when Prisma throws — error logged via console.error and trace flushed', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFindUnique.mockRejectedValue(new Error('db connection lost'))

    const req = makeRequest({ body: { source: 'downloads', content_hash: 'h_err' } })
    const res = await POST(req)
    expect(res.status).toBe(500)
    expect(consoleSpy).toHaveBeenCalled()
    // X-Trace-Id is still set on the error path
    expect(res.headers.get('X-Trace-Id')).toBeTruthy()

    consoleSpy.mockRestore()
  })

  // ---- Heartbeat short-circuit (Phase 6 Plan 01, Task 1) ----
  // Per CONTEXT D-heartbeat: POST /api/ingest with body { heartbeat: true } returns
  // 204 No Content, performs no Item write, and emits no Langfuse trace work.
  // Auth still gates the heartbeat path (Test C).

  it('Test 10: heartbeat returns 204 with empty body and never touches Item table', async () => {
    const req = makeRequest({ body: { heartbeat: true } })
    const res = await POST(req)
    expect(res.status).toBe(204)
    // 204 has no body
    expect(await res.text()).toBe('')
    // Critical: no DB I/O on the heartbeat path
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('Test 11: heartbeat path emits no Langfuse span work (no dedup-check, no item-create span)', async () => {
    const req = makeRequest({ body: { heartbeat: true } })
    const res = await POST(req)
    expect(res.status).toBe(204)
    // The heartbeat short-circuit must NOT open any span — every 60s ping would
    // otherwise flood Langfuse. Only the daemon-side 5-min heartbeat trace exists.
    expect(__langfuseTraceMock.span).not.toHaveBeenCalled()
  })

  it('Test 12: heartbeat without Authorization still returns 401 (auth precedes short-circuit)', async () => {
    const req = makeRequest({ auth: null, body: { heartbeat: true } })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    // No span work on the unauthorised heartbeat path either
    expect(__langfuseTraceMock.span).not.toHaveBeenCalled()
  })
})
