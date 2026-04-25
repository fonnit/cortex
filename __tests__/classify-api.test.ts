/**
 * POST /api/classify API route tests
 *
 * Validates the consumer-feedback endpoint used by Phase 7 Stage 1/2 consumers.
 * Per CONTEXT decisions:
 * - CORTEX_API_KEY shared-secret Bearer auth (empty 401 body on failure)
 * - State-machine transitions:
 *   - stage 1 success: keep → pending_stage2; ignore → ignored; uncertain → uncertain
 *   - stage 2 success: all axes confidence >= 0.75 → certain; else uncertain
 *   - error path: increment classification_trace.queue.stageN.retries; if retries
 *     >= RETRY_CAP (5) → status='error' (terminal); else status back to pending_stageN
 * - X-Trace-Id response header on every return path
 *
 * Split into two describe blocks for cognitive load:
 *   1) success path (Task 2a — 9 tests)
 *   2) error path (Task 2b — 5 tests)
 */

// Mock Prisma before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

// Mock Langfuse — return a stable trace.id so we can assert the X-Trace-Id header
jest.mock('langfuse', () => {
  const span = { end: jest.fn() }
  const trace = { id: 'trace_test_classify', span: jest.fn(() => span) }
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
import { POST } from '../app/api/classify/route'
import { prisma } from '../lib/prisma'

const mockFindUnique = prisma.item.findUnique as jest.MockedFunction<typeof prisma.item.findUnique>
const mockUpdate = prisma.item.update as jest.MockedFunction<typeof prisma.item.update>

function makeRequest(opts: { body?: unknown; auth?: string | null } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.auth !== null) {
    headers.authorization = opts.auth ?? 'Bearer test-secret'
  }
  return new Request('http://localhost/api/classify', {
    method: 'POST',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }) as unknown as NextRequest
}

/** Build a minimal Item fixture for findUnique mocks. */
function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item_xyz',
    user_id: 'cortex_owner',
    content_hash: 'hash_xyz',
    source: 'downloads',
    status: 'pending_stage1',
    classification_trace: null,
    axis_type: null,
    axis_from: null,
    axis_context: null,
    axis_type_confidence: null,
    axis_from_confidence: null,
    axis_context_confidence: null,
    proposed_drive_path: null,
    ...overrides,
  }
}

describe('POST /api/classify — success path', () => {
  beforeEach(() => {
    process.env.CORTEX_API_KEY = 'test-secret'
    jest.clearAllMocks()
  })

  it('Test 1: returns 401 with empty body when Authorization header is missing', async () => {
    const req = makeRequest({
      auth: null,
      body: { item_id: 'item_xyz', stage: 1, outcome: 'success', decision: 'keep' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    // Auth runs first — DB never touched
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('Test 2: returns 400 validation_failed when stage is not 1 or 2', async () => {
    const req = makeRequest({
      body: { item_id: 'item_xyz', stage: 3, outcome: 'success', decision: 'keep' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('validation_failed')
    expect(Array.isArray(json.issues)).toBe(true)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('Test 3: returns 400 validation_failed when outcome is neither success nor error', async () => {
    const req = makeRequest({
      body: { item_id: 'item_xyz', stage: 1, outcome: 'maybe' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('validation_failed')
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('Test 4: returns 404 item_not_found when item_id does not exist', async () => {
    mockFindUnique.mockResolvedValue(null as never)

    const req = makeRequest({
      body: { item_id: 'item_missing', stage: 1, outcome: 'success', decision: 'keep' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('item_not_found')
    expect(mockUpdate).not.toHaveBeenCalled()
    // X-Trace-Id is set even on the 404 path
    expect(res.headers.get('X-Trace-Id')).toBeTruthy()
  })

  it('Test 5: stage=1 outcome=success decision=keep → status=pending_stage2 + stage1 trace merged', async () => {
    mockFindUnique.mockResolvedValue(makeItem() as never)
    mockUpdate.mockResolvedValue(makeItem({ status: 'pending_stage2' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'keep',
        confidence: 0.92,
        reason: 'looks like an invoice',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.status).toBe('pending_stage2')

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const updateArg = mockUpdate.mock.calls[0][0] as { where: { id: string }; data: Record<string, unknown> }
    expect(updateArg.where.id).toBe('item_xyz')
    expect(updateArg.data.status).toBe('pending_stage2')
    const trace = updateArg.data.classification_trace as Record<string, unknown>
    expect(trace.stage1).toEqual(
      expect.objectContaining({ decision: 'keep', confidence: 0.92, reason: 'looks like an invoice' }),
    )
    // queue.stage1.retries reset to 0 on success
    expect((trace.queue as Record<string, { retries: number }>).stage1.retries).toBe(0)
  })

  it('Test 6: stage=1 outcome=success decision=ignore → status=ignored', async () => {
    mockFindUnique.mockResolvedValue(makeItem() as never)
    mockUpdate.mockResolvedValue(makeItem({ status: 'ignored' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'ignore',
        confidence: 0.95,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ignored')

    const updateArg = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.status).toBe('ignored')
  })

  it('Test 7: stage=1 outcome=success decision=uncertain → status=uncertain', async () => {
    mockFindUnique.mockResolvedValue(makeItem() as never)
    mockUpdate.mockResolvedValue(makeItem({ status: 'uncertain' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'uncertain',
        confidence: 0.4,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('uncertain')

    const updateArg = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.status).toBe('uncertain')
  })

  it('Test 8: stage=2 outcome=success all axes confident (>=0.75) → status=certain + axes written', async () => {
    mockFindUnique.mockResolvedValue(
      makeItem({ status: 'pending_stage2', classification_trace: { stage1: { decision: 'keep' } } }) as never,
    )
    mockUpdate.mockResolvedValue(makeItem({ status: 'certain' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.85 },
          context: { value: 'work', confidence: 0.8 },
        },
        proposed_drive_path: '/Cortex/Work/Acme/Invoices/2026',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('certain')

    const updateArg = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.status).toBe('certain')
    expect(updateArg.data.axis_type).toBe('invoice')
    expect(updateArg.data.axis_from).toBe('acme')
    expect(updateArg.data.axis_context).toBe('work')
    expect(updateArg.data.axis_type_confidence).toBe(0.9)
    expect(updateArg.data.axis_from_confidence).toBe(0.85)
    expect(updateArg.data.axis_context_confidence).toBe(0.8)
    expect(updateArg.data.proposed_drive_path).toBe('/Cortex/Work/Acme/Invoices/2026')

    // Existing stage1 preserved, stage2.axes merged in
    const trace = updateArg.data.classification_trace as Record<string, unknown>
    expect((trace.stage1 as Record<string, unknown>).decision).toBe('keep')
    expect((trace.stage2 as Record<string, unknown>).axes).toEqual(
      expect.objectContaining({
        type: { value: 'invoice', confidence: 0.9 },
      }),
    )
    // queue.stage2.retries reset to 0 on success
    expect((trace.queue as Record<string, { retries: number }>).stage2.retries).toBe(0)
  })

  it('Test 9: stage=2 outcome=success any axis below threshold → status=uncertain', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'pending_stage2' }) as never)
    mockUpdate.mockResolvedValue(makeItem({ status: 'uncertain' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.85 },
          context: { value: null, confidence: 0.4 }, // below 0.75 threshold
        },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('uncertain')

    const updateArg = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.status).toBe('uncertain')
    // X-Trace-Id is set on every success-path response
    expect(res.headers.get('X-Trace-Id')).toBeTruthy()
  })
})
