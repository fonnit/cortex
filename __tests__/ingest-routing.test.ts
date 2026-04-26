/**
 * POST /api/ingest routing tests — quick task 260426-u47.
 *
 * Validates the routing decision (Stage 1 vs straight-to-Stage 2) at ingest time
 * per CONTEXT decision D-stage1-routing:
 *
 *   Stage 1 (relevance gate) runs only when:
 *     - source = 'downloads' AND size_bytes > STAGE1_MIN_SIZE_BYTES (1 MiB), OR
 *     - source = 'gmail' AND has at least one attachment with
 *       size_bytes > STAGE1_MIN_SIZE_BYTES.
 *
 *   All other items go straight to Stage 2 (status='pending_stage2').
 *
 *   Defensive default: a downloads item with no size_bytes routes to Stage 1
 *   (treat unknown as "potentially large").
 *
 * Mirrors the patterns from __tests__/ingest-api.test.ts: Prisma mocked at the
 * module boundary, Langfuse stubbed with stable trace.id, request built via the
 * shared helper.
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

// Mock Langfuse — stable trace.id so X-Trace-Id is assertable.
const __langfuseSpanMock = { end: jest.fn() }
const __langfuseTraceMock = { id: 'trace_test_routing', span: jest.fn(() => __langfuseSpanMock) }
const __langfuseFlushMock = jest.fn().mockResolvedValue(undefined)
jest.mock('langfuse', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      trace: jest.fn(() => __langfuseTraceMock),
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

function statusFromCreate(): string {
  expect(mockCreate).toHaveBeenCalledTimes(1)
  const arg = mockCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
  return arg.data.status as string
}

describe('POST /api/ingest — routing decision (quick task 260426-u47)', () => {
  beforeEach(() => {
    process.env.CORTEX_API_KEY = 'test-secret'
    jest.clearAllMocks()
    mockFindUnique.mockResolvedValue(null as never)
    mockCreate.mockResolvedValue({ id: 'item_routed' } as never)
  })

  it('Test 1: small downloads file (500 KB) → status=pending_stage2', async () => {
    const req = makeRequest({
      body: {
        source: 'downloads',
        content_hash: 'h1',
        size_bytes: 500_000,
        file_path: '/tmp/foo.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(statusFromCreate()).toBe('pending_stage2')
  })

  it('Test 2: large downloads file (2 MiB) → status=pending_stage1', async () => {
    const req = makeRequest({
      body: {
        source: 'downloads',
        content_hash: 'h2',
        size_bytes: 2_000_000,
        file_path: '/tmp/big.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(statusFromCreate()).toBe('pending_stage1')
  })

  it('Test 3: boundary — downloads file at exactly 1 MiB (1_048_576) → pending_stage2 (strictly greater than)', async () => {
    const req = makeRequest({
      body: {
        source: 'downloads',
        content_hash: 'h3',
        size_bytes: 1_048_576,
        file_path: '/tmp/exactly_one_mib.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    // STAGE1_MIN_SIZE_BYTES is a strict-greater-than threshold per CONTEXT —
    // exactly 1 MiB does NOT cross it, so the item skips Stage 1.
    expect(statusFromCreate()).toBe('pending_stage2')
  })

  it('Test 4: gmail email with NO attachments → status=pending_stage2', async () => {
    const req = makeRequest({
      body: {
        source: 'gmail',
        content_hash: 'h4',
        source_metadata: { subject: 'hello', from: 'a@b.com' },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(statusFromCreate()).toBe('pending_stage2')
  })

  it('Test 5: gmail email with all attachments ≤ 1 MiB → status=pending_stage2', async () => {
    const req = makeRequest({
      body: {
        source: 'gmail',
        content_hash: 'h5',
        source_metadata: {
          subject: 'with small attachments',
          from: 'a@b.com',
          attachments: [
            { size_bytes: 100_000 },
            // Boundary attachment — exactly 1 MiB does NOT trigger Stage 1.
            { size_bytes: 1_048_576 },
          ],
        },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(statusFromCreate()).toBe('pending_stage2')
  })

  it('Test 6: gmail email with at least one attachment > 1 MiB → status=pending_stage1', async () => {
    const req = makeRequest({
      body: {
        source: 'gmail',
        content_hash: 'h6',
        source_metadata: {
          subject: 'big attachment',
          from: 'a@b.com',
          attachments: [
            { size_bytes: 100_000 },
            { size_bytes: 2_000_000 },
          ],
        },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(statusFromCreate()).toBe('pending_stage1')
  })

  it('Test 7: downloads with NO size_bytes → defensive default = pending_stage1', async () => {
    // Unknown size could be huge; safe default is to route through Stage 1.
    const req = makeRequest({
      body: {
        source: 'downloads',
        content_hash: 'h7',
        file_path: '/tmp/unknown_size.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(statusFromCreate()).toBe('pending_stage1')
  })

  it('Test 8: heartbeat path unchanged — returns 204, no Item.create', async () => {
    const req = makeRequest({ body: { heartbeat: true } })
    const res = await POST(req)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('Test 9: dedup path unchanged — existing content_hash returns deduped:true with NO routing recompute', async () => {
    // findUnique returns an existing item; create must never run.
    mockFindUnique.mockResolvedValue({
      id: 'item_existing_routed',
      content_hash: 'h_existing',
    } as never)

    const req = makeRequest({
      body: {
        source: 'downloads',
        content_hash: 'h_existing',
        size_bytes: 5_000_000, // would have routed to stage1 if recomputed
        file_path: '/tmp/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ id: 'item_existing_routed', deduped: true })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('Defensive: gmail with malformed attachments array (non-array) → pending_stage2 (no crash)', async () => {
    // T-u47-01 mitigation — malformed source_metadata must not crash the route.
    const req = makeRequest({
      body: {
        source: 'gmail',
        content_hash: 'h_malformed',
        source_metadata: {
          subject: 'malformed',
          from: 'a@b.com',
          attachments: 'not-an-array',
        },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(statusFromCreate()).toBe('pending_stage2')
  })

  it('Defensive: gmail with attachments containing non-numeric size_bytes → pending_stage2 (no crash)', async () => {
    const req = makeRequest({
      body: {
        source: 'gmail',
        content_hash: 'h_bad_attach',
        source_metadata: {
          subject: 'attachments without sizes',
          from: 'a@b.com',
          attachments: [{ size_bytes: 'huge' }, {}],
        },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(statusFromCreate()).toBe('pending_stage2')
  })
})
