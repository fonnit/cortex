/**
 * GET /api/queue API route tests (mocked unit)
 *
 * Validates the read/claim endpoint used by Phase 7 consumers.
 * Per CONTEXT decisions:
 * - CORTEX_API_KEY shared-secret Bearer auth (empty 401 body on failure)
 * - Atomic claim via raw SQL (FOR UPDATE SKIP LOCKED) routed through
 *   `prisma.$queryRaw` so the same code runs against PrismaNeon (prod Neon
 *   URL) or PrismaPg (vanilla localhost Postgres) without changes.
 * - Stale reclaim runs BEFORE claim each call; legacy reclaim folds in too
 * - Response: { items: [...], reclaimed: <number> }; X-Trace-Id on every response
 *
 * `prisma.$queryRaw` is mocked via `@/lib/prisma` — we record every
 * tagged-template call (template strings reconstructed with `$N` positional
 * placeholders, plus the values array) so we can assert which SQL fired in
 * which order, and what parameters were passed. Same recorder mechanism the
 * tests previously used against neon(); only the mock surface moved.
 *
 * The actual SQL is exercised against a real Postgres surface in
 * __tests__/queue-claim-sql.integration.test.ts (pg-mem).
 */

// Mock @/lib/prisma — feed in tagged-template responses via $queryRaw.
// $transaction([...]) is the route's actual call site; default impl awaits all
// promises via allSettled then re-throws the first rejection (mirrors prisma's
// sequential-array semantics AND keeps node from logging "unhandled rejection"
// when an error test rejects all 3 mocked $queryRaw calls).
jest.mock('../lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (arr: Promise<unknown>[]) => {
      const results = await Promise.allSettled(arr)
      const firstReject = results.find((r) => r.status === 'rejected')
      if (firstReject && firstReject.status === 'rejected') {
        throw firstReject.reason
      }
      return results.map((r) => (r as PromiseFulfilledResult<unknown>).value)
    }),
  },
}))

// Mock Langfuse — stable trace.id for X-Trace-Id assertions
jest.mock('langfuse', () => {
  const span = { end: jest.fn() }
  const trace = { id: 'trace_test_queue', span: jest.fn(() => span) }
  const flushAsync = jest.fn().mockResolvedValue(undefined)
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      trace: jest.fn(() => trace),
      flushAsync,
    })),
  }
})

import type { NextRequest } from 'next/server'
import { GET } from '../app/api/queue/route'
import { prisma } from '../lib/prisma'

const mockQueryRaw = prisma.$queryRaw as jest.MockedFunction<typeof prisma.$queryRaw>

/**
 * Build a fake `prisma.$queryRaw` implementation that returns each queued
 * response in order, and records every call (strings + interpolated values)
 * for assertions. The signature matches Prisma's tagged-template overload:
 *   $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[])
 */
function makeSqlMock(responses: Array<Array<Record<string, unknown>>>) {
  let i = 0
  const calls: Array<{ text: string; values: unknown[] }> = []
  const impl = (strings: TemplateStringsArray, ...values: unknown[]) => {
    // Reconstruct the rendered SQL the way prisma.$queryRaw would —
    // interleave template strings with positional placeholders ($1, $2, ...)
    const text = strings.reduce((acc, str, idx) => {
      return acc + str + (idx < values.length ? `$${idx + 1}` : '')
    }, '')
    calls.push({ text, values })
    const r = responses[i++] ?? []
    return Promise.resolve(r)
  }
  return { impl, calls }
}

function makeRequest(opts: { url?: string; auth?: string | null } = {}): NextRequest {
  const headers: Record<string, string> = {}
  if (opts.auth !== null) {
    headers.authorization = opts.auth ?? 'Bearer test-secret'
  }
  return new Request(opts.url ?? 'http://localhost/api/queue?stage=1&limit=10', {
    method: 'GET',
    headers,
  }) as unknown as NextRequest
}

describe('GET /api/queue', () => {
  beforeEach(() => {
    process.env.CORTEX_API_KEY = 'test-secret'
    // DATABASE_URL is no longer read by the route directly (prisma is fully
    // mocked), but lib/prisma may still try to read it at module-evaluation
    // time. Keep the env stub as defence against hoisting surprises.
    process.env.DATABASE_URL = 'postgres://test'
    jest.clearAllMocks()
  })

  it('Test 1: returns 401 with empty body when Authorization header is missing', async () => {
    const req = makeRequest({ auth: null })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    // prisma.$queryRaw should never be called when auth fails
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })

  it('Test 2: returns 401 with empty body when Bearer token is wrong', async () => {
    const req = makeRequest({ auth: 'Bearer wrong-token' })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })

  it('Test 3: returns 400 validation_failed when stage is missing or not 1/2', async () => {
    // Missing stage
    const r1 = await GET(makeRequest({ url: 'http://localhost/api/queue?limit=10' }))
    expect(r1.status).toBe(400)
    const j1 = await r1.json()
    expect(j1.error).toBe('validation_failed')

    // stage=3 (out of range)
    const r2 = await GET(makeRequest({ url: 'http://localhost/api/queue?stage=3&limit=10' }))
    expect(r2.status).toBe(400)
    expect((await r2.json()).error).toBe('validation_failed')

    // stage=foo (not enum)
    const r3 = await GET(makeRequest({ url: 'http://localhost/api/queue?stage=foo&limit=10' }))
    expect(r3.status).toBe(400)
    expect((await r3.json()).error).toBe('validation_failed')
  })

  it('Test 4: returns 400 validation_failed when limit is missing or not a positive int', async () => {
    // Missing limit
    const r1 = await GET(makeRequest({ url: 'http://localhost/api/queue?stage=1' }))
    expect(r1.status).toBe(400)
    expect((await r1.json()).error).toBe('validation_failed')

    // limit=0
    const r2 = await GET(makeRequest({ url: 'http://localhost/api/queue?stage=1&limit=0' }))
    expect(r2.status).toBe(400)
    expect((await r2.json()).error).toBe('validation_failed')

    // limit=abc (not numeric)
    const r3 = await GET(makeRequest({ url: 'http://localhost/api/queue?stage=1&limit=abc' }))
    expect(r3.status).toBe(400)
    expect((await r3.json()).error).toBe('validation_failed')
  })

  it('Test 5: returns 400 validation_failed when limit > 100 (DoS cap)', async () => {
    const res = await GET(makeRequest({ url: 'http://localhost/api/queue?stage=1&limit=500' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('validation_failed')
    // Cap protects us from a single caller pulling the whole table — $queryRaw never called
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })

  it('Test 6: stage=1 limit=10 — issues 3 SQL calls (stale, legacy, claim) and returns { items, reclaimed }', async () => {
    const { impl, calls } = makeSqlMock([
      [{ id: 'reclaimed_1' }],                          // stale reclaim → 1 row
      [],                                               // legacy reclaim → 0 rows
      [                                                 // atomic claim → 1 row
        {
          id: 'item_1',
          source: 'downloads',
          filename: 'a.pdf',
          mime_type: 'application/pdf',
          size_bytes: 100,
          content_hash: 'h1',
          source_metadata: null,
        },
      ],
    ])
    mockQueryRaw.mockImplementation(impl as never)

    const res = await GET(makeRequest({ url: 'http://localhost/api/queue?stage=1&limit=10' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      items: [
        {
          id: 'item_1',
          source: 'downloads',
          filename: 'a.pdf',
          mime_type: 'application/pdf',
          size_bytes: 100,
          content_hash: 'h1',
          source_metadata: null,
          file_path: null,
        },
      ],
      reclaimed: 1, // 1 stale + 0 legacy
    })

    expect(calls).toHaveLength(3)
    // Call 0 — stale reclaim for stage 1
    expect(calls[0].text).toMatch(/UPDATE\s+"Item"/)
    expect(calls[0].text).toMatch(/SET status =/)
    expect(calls[0].values).toEqual(
      expect.arrayContaining(['pending_stage1', 'processing_stage1', 'stage1']),
    )
    // Call 1 — legacy reclaim runs every call regardless of stage.
    // The route parameterizes 'processing' via QUEUE_STATUSES.LEGACY_PROCESSING,
    // so we assert on the parameter value rather than a literal in the text.
    expect(calls[1].text).toMatch(/classification_trace \? 'stage2'/)
    expect(calls[1].values).toEqual(expect.arrayContaining(['processing']))
    // Call 2 — atomic claim for stage 1
    expect(calls[2].text).toMatch(/FOR UPDATE SKIP LOCKED/)
    expect(calls[2].values).toEqual(
      expect.arrayContaining(['pending_stage1', 'processing_stage1', 'stage1', 10]),
    )
    // nowIso parameter present and ISO-shaped
    const nowIsoVal = calls[2].values.find(
      (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v as string),
    )
    expect(nowIsoVal).toBeTruthy()
  })

  it('Test 7: stage=2 limit=2 — claim SQL parameterizes pending_stage2/processing_stage2', async () => {
    const { impl, calls } = makeSqlMock([
      [],                          // stale reclaim
      [],                          // legacy reclaim
      [],                          // claim returns nothing
    ])
    mockQueryRaw.mockImplementation(impl as never)

    const res = await GET(makeRequest({ url: 'http://localhost/api/queue?stage=2&limit=2' }))
    expect(res.status).toBe(200)
    expect(calls[0].values).toEqual(
      expect.arrayContaining(['pending_stage2', 'processing_stage2', 'stage2']),
    )
    expect(calls[2].values).toEqual(
      expect.arrayContaining(['pending_stage2', 'processing_stage2', 'stage2', 2]),
    )
  })

  it('Test 8: each item hoists file_path from source_metadata (or null)', async () => {
    const { impl } = makeSqlMock([
      [],
      [],
      [
        {
          id: 'item_with_path',
          source: 'downloads',
          filename: 'x.pdf',
          mime_type: 'application/pdf',
          size_bytes: 12,
          content_hash: 'h2',
          source_metadata: { file_path: '/Users/foo/Downloads/x.pdf', extra: 'meta' },
        },
        {
          id: 'item_no_path',
          source: 'gmail',
          filename: null,
          mime_type: null,
          size_bytes: null,
          content_hash: 'h3',
          source_metadata: { from: 'someone@example.com' },
        },
      ],
    ])
    mockQueryRaw.mockImplementation(impl as never)

    const res = await GET(makeRequest())
    const json = await res.json()
    expect(json.items[0]).toEqual({
      id: 'item_with_path',
      source: 'downloads',
      filename: 'x.pdf',
      mime_type: 'application/pdf',
      size_bytes: 12,
      content_hash: 'h2',
      source_metadata: { file_path: '/Users/foo/Downloads/x.pdf', extra: 'meta' },
      file_path: '/Users/foo/Downloads/x.pdf',
    })
    expect(json.items[1].file_path).toBeNull()
  })

  it('Test 9: stale reclaim runs BEFORE claim — call order is stale → legacy → claim', async () => {
    const { impl, calls } = makeSqlMock([[], [], []])
    mockQueryRaw.mockImplementation(impl as never)

    await GET(makeRequest())
    expect(calls).toHaveLength(3)
    // Verify ordering by content
    expect(calls[0].text).not.toMatch(/FOR UPDATE SKIP LOCKED/) // stale
    expect(calls[1].text).toMatch(/classification_trace \? 'stage2'/) // legacy
    expect(calls[2].text).toMatch(/FOR UPDATE SKIP LOCKED/) // claim
  })

  it('Test 10: reclaimed count = stale_reclaimed + legacy_reclaimed', async () => {
    const { impl } = makeSqlMock([
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }], // 3 stale
      [{ id: 'x' }, { id: 'y' }],              // 2 legacy
      [],                                       // 0 claimed
    ])
    mockQueryRaw.mockImplementation(impl as never)

    const res = await GET(makeRequest())
    const json = await res.json()
    expect(json.reclaimed).toBe(5)
    expect(json.items).toEqual([])
  })

  it('Test 11: response includes header X-Trace-Id with non-empty value', async () => {
    const { impl } = makeSqlMock([[], [], []])
    mockQueryRaw.mockImplementation(impl as never)

    const res = await GET(makeRequest())
    const tid = res.headers.get('X-Trace-Id')
    expect(tid).toBeTruthy()
    expect(typeof tid).toBe('string')
    expect((tid as string).length).toBeGreaterThan(0)
  })

  it('Test 12: returns 500 when prisma.$queryRaw rejects — error logged and X-Trace-Id still set', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockQueryRaw.mockImplementation((() =>
      Promise.reject(new Error('db connection lost'))) as never)

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect(consoleSpy).toHaveBeenCalled()
    expect(res.headers.get('X-Trace-Id')).toBeTruthy()

    consoleSpy.mockRestore()
  })

  it('Test 13: when claim returns zero rows — HTTP 200 with empty items + reclaimed count', async () => {
    const { impl } = makeSqlMock([[], [], []])
    mockQueryRaw.mockImplementation(impl as never)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ items: [], reclaimed: 0 })
  })
})
