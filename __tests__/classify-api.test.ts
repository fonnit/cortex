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
 * Three describe blocks:
 *   1) success path
 *   2) error path
 *   3) stale-claim race guard + Zod schema hardening (review fixes [1], [2], [3], [7])
 */

// Mock Prisma before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findUnique: jest.fn(),
      // updateMany is the mutation surface — the route uses a compound
      // `where: { id, status }` to enforce the stale-claim race guard
      // (review fix [3]). The route no longer calls plain `update`.
      updateMany: jest.fn(),
    },
    // taxonomyLabel.findMany feeds the cold-start guard added in quick task
    // 260426-u47. The Stage 2 success path now reads it before deciding
    // status; tests that exercise that path mock it explicitly.
    taxonomyLabel: {
      findMany: jest.fn(),
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
const mockUpdateMany = prisma.item.updateMany as jest.MockedFunction<typeof prisma.item.updateMany>
const mockTaxonomyFindMany = (
  prisma as unknown as { taxonomyLabel: { findMany: jest.Mock } }
).taxonomyLabel.findMany

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

/** Build a minimal Item fixture for findUnique mocks.
 *
 * Default status='processing_stage1' — by the time a consumer POSTs to
 * /api/classify, the item must be in processing_stage{N}, not pending. The
 * race guard added for review fix [3] returns 409 if the item is in any
 * other status. Tests that exercise stage 2 should override status='processing_stage2'.
 */
function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item_xyz',
    user_id: 'cortex_owner',
    content_hash: 'hash_xyz',
    source: 'downloads',
    status: 'processing_stage1',
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
    // Default: updateMany matches the row (count: 1) so non-race tests succeed.
    mockUpdateMany.mockResolvedValue({ count: 1 } as never)
    // Default cold-start guard read returns no labels — Stage 2 tests below
    // exercise the existing CERTAIN/UNCERTAIN fallback (decision='uncertain'
    // doesn't trigger auto-file, so vocabulary doesn't matter for them).
    mockTaxonomyFindMany.mockResolvedValue([] as never)
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
    expect(mockUpdateMany).not.toHaveBeenCalled()
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
    expect(mockUpdateMany).not.toHaveBeenCalled()
    // X-Trace-Id is set even on the 404 path
    expect(res.headers.get('X-Trace-Id')).toBeTruthy()
  })

  it('Test 5: stage=1 outcome=success decision=keep → status=pending_stage2 + stage1 trace merged', async () => {
    mockFindUnique.mockResolvedValue(makeItem() as never)

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

    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    const updateArg = mockUpdateMany.mock.calls[0][0] as {
      where: { id: string; status: string }
      data: Record<string, unknown>
    }
    expect(updateArg.where.id).toBe('item_xyz')
    // Race guard (review fix [3]): the compound where pins the expected status
    expect(updateArg.where.status).toBe('processing_stage1')
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

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.status).toBe('ignored')
  })

  it('Test 7: stage=1 outcome=success decision=uncertain → status=uncertain', async () => {
    mockFindUnique.mockResolvedValue(makeItem() as never)

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

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.status).toBe('uncertain')
  })

  it('Test 8: stage=2 outcome=success all axes confident (>=0.75) → status=certain + axes written', async () => {
    mockFindUnique.mockResolvedValue(
      makeItem({ status: 'processing_stage2', classification_trace: { stage1: { decision: 'keep' } } }) as never,
    )

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        // u47: Stage 2 success now requires `decision`. 'uncertain' here
        // exercises the existing CERTAIN/UNCERTAIN fallback (no auto-action).
        decision: 'uncertain',
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

    const updateArg = mockUpdateMany.mock.calls[0][0] as {
      where: { id: string; status: string }
      data: Record<string, unknown>
    }
    // Race guard pins processing_stage2 for stage=2
    expect(updateArg.where.status).toBe('processing_stage2')
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
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        // u47: Stage 2 success requires `decision`.
        decision: 'uncertain',
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

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.status).toBe('uncertain')
    // X-Trace-Id is set on every success-path response
    expect(res.headers.get('X-Trace-Id')).toBeTruthy()
  })
})

describe('POST /api/classify — error path', () => {
  beforeEach(() => {
    process.env.CORTEX_API_KEY = 'test-secret'
    jest.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 } as never)
    mockTaxonomyFindMany.mockResolvedValue([] as never)
  })

  it('Test 1: stage=1 outcome=error with no prior retries → retries=1, status=pending_stage1, last_error persisted', async () => {
    // Item has no classification_trace yet — first failure mid-flight
    mockFindUnique.mockResolvedValue(makeItem({ classification_trace: null }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'error',
        error_message: 'boom',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.status).toBe('pending_stage1')
    expect(json.retries).toBe(1)

    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    const updateArg = mockUpdateMany.mock.calls[0][0] as {
      where: { id: string; status: string }
      data: Record<string, unknown>
    }
    expect(updateArg.where.status).toBe('processing_stage1')
    expect(updateArg.data.status).toBe('pending_stage1')
    const trace = updateArg.data.classification_trace as {
      queue: { stage1: { retries: number; last_error: string } }
    }
    expect(trace.queue.stage1.retries).toBe(1)
    expect(trace.queue.stage1.last_error).toBe('boom')
  })

  it('Test 2: stage=1 outcome=error at retry cap (prev=4, new=5) → status=error (terminal), retries=5', async () => {
    // Existing trace has 4 prior failures on stage1 — this 5th failure hits RETRY_CAP and goes terminal
    mockFindUnique.mockResolvedValue(
      makeItem({
        classification_trace: { queue: { stage1: { retries: 4 } } },
      }) as never,
    )

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'error',
        error_message: 'final straw',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('error')
    expect(json.retries).toBe(5)

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    // Terminal status — note: NOT pending_stage1
    expect(updateArg.data.status).toBe('error')
    const trace = updateArg.data.classification_trace as {
      queue: { stage1: { retries: number; last_error: string } }
    }
    expect(trace.queue.stage1.retries).toBe(5)
    expect(trace.queue.stage1.last_error).toBe('final straw')
  })

  it('Test 3: stage=2 outcome=error at retry cap (prev=4, new=5) → status=error (terminal), retries=5', async () => {
    // Stage isolation — stage2 retries hitting cap should NOT affect stage1 counter
    mockFindUnique.mockResolvedValue(
      makeItem({
        status: 'processing_stage2',
        classification_trace: {
          stage1: { decision: 'keep' },
          queue: { stage1: { retries: 1 }, stage2: { retries: 4 } },
        },
      }) as never,
    )

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'error',
        error_message: 'stage2 collapsed',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('error')
    expect(json.retries).toBe(5)

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.status).toBe('error')
    const trace = updateArg.data.classification_trace as {
      stage1: Record<string, unknown>
      queue: {
        stage1: { retries: number }
        stage2: { retries: number; last_error: string }
      }
    }
    // Stage 2 incremented to cap
    expect(trace.queue.stage2.retries).toBe(5)
    expect(trace.queue.stage2.last_error).toBe('stage2 collapsed')
    // Stage 1 counter UNCHANGED (stage isolation)
    expect(trace.queue.stage1.retries).toBe(1)
    // Existing stage1 trace preserved
    expect(trace.stage1.decision).toBe('keep')
  })

  it('Test 4: stage=2 outcome=error mid-flight (prev=2, new=3) → status=pending_stage2, retries=3', async () => {
    mockFindUnique.mockResolvedValue(
      makeItem({
        status: 'processing_stage2',
        classification_trace: { queue: { stage2: { retries: 2 } } },
      }) as never,
    )

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'error',
        error_message: 'transient timeout',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('pending_stage2')
    expect(json.retries).toBe(3)

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    // Below cap — bounce back to pending_stage2 for another attempt
    expect(updateArg.data.status).toBe('pending_stage2')
    const trace = updateArg.data.classification_trace as {
      queue: { stage2: { retries: number; last_error: string } }
    }
    expect(trace.queue.stage2.retries).toBe(3)
    expect(trace.queue.stage2.last_error).toBe('transient timeout')
  })

  it('Test 5: all error-path responses include header X-Trace-Id', async () => {
    mockFindUnique.mockResolvedValue(makeItem() as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'error',
        error_message: 'whatever',
      },
    })
    const res = await POST(req)
    const traceId = res.headers.get('X-Trace-Id')
    expect(traceId).toBeTruthy()
    expect(typeof traceId).toBe('string')
    expect((traceId as string).length).toBeGreaterThan(0)
  })
})

/**
 * Review fix tests — guard the four correctness bugs called out in 05-REVIEW.md:
 *   [1] Stage 2 partial axes silently zeroed confidences for omitted axes
 *   [2] Stage 2 axis with value:null + confidence>=0.75 flipped status to certain
 *   [3] Slow consumer's POST overwrote a re-claimer's already-completed work
 *   [7] Stage 1 trace's `confidence`/`reason` undefined wiped prior values
 */
describe('POST /api/classify — review fix coverage', () => {
  beforeEach(() => {
    process.env.CORTEX_API_KEY = 'test-secret'
    jest.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 } as never)
    mockTaxonomyFindMany.mockResolvedValue([] as never)
  })

  // ─── Review fix [1] — Stage 2 partial-axes payload is rejected ─────────────
  it('Fix [1]: stage=2 success with only `type` axis (omitting from/context) → 400 validation_failed', async () => {
    // Schema now requires all three axes. The Zod refusal happens BEFORE
    // findUnique runs, so the DB is never touched.
    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          // from + context omitted — silently zeroing those confidences would
          // be the pre-fix data-loss bug. Schema now rejects it.
        },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('validation_failed')
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  // ─── Review fix [2] — value:null with high confidence is rejected ──────────
  it('Fix [2]: stage=2 success with axis value=null + confidence=0.95 → 400 validation_failed', async () => {
    // The AxisSchema refinement rejects this contradiction. Pre-fix, the
    // route would have read confidence=0.95 and flipped status='certain'
    // while leaving the axis_type column null/stale.
    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        axes: {
          type: { value: null, confidence: 0.95 }, // contradiction
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'work', confidence: 0.9 },
        },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('validation_failed')
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('Fix [2]: stage=2 success with all axes value=null + confidence<0.75 → status=uncertain (not certain)', async () => {
    // Three null-value axes, all with low confidence — schema accepts this.
    // The status MUST be uncertain because no axis is confident.
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        // u47: Stage 2 success requires `decision`. Low-confidence ignore
        // here would NOT trigger auto-ignore (max axis conf 0.3 < 0.85), so
        // the existing 'uncertain' fallback still applies. Use 'uncertain'
        // explicitly to make intent clear.
        decision: 'uncertain',
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.2 },
          context: { value: null, confidence: 0.3 },
        },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('uncertain')
  })

  // ─── Review fix [3] — TOCTOU race guard returns 409 ────────────────────────
  it('Fix [3]: stage=1 POST when item.status is `pending_stage1` (reclaimed) → 409, no update', async () => {
    // Slow consumer's POST after the queue moved the item back to pending —
    // pre-fix, this would silently overwrite the re-claimer's work. Now the
    // race guard returns 409 and never touches the DB.
    mockFindUnique.mockResolvedValue(makeItem({ status: 'pending_stage1' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'keep',
        confidence: 0.9,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('item_no_longer_claimed')
    expect(json.current_status).toBe('pending_stage1')
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(res.headers.get('X-Trace-Id')).toBeTruthy()
  })

  it('Fix [3]: stage=1 POST when item.status is `ignored` (terminal) → 409, no update', async () => {
    // The most damaging concrete race in the REVIEW: another consumer ran
    // the item to `ignored`, our slow POST tries to flip it back to a live
    // queue state. Race guard catches it.
    mockFindUnique.mockResolvedValue(makeItem({ status: 'ignored' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'keep',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('item_no_longer_claimed')
    expect(json.current_status).toBe('ignored')
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('Fix [3]: stage=2 POST when item.status is `processing_stage1` (wrong stage) → 409, no update', async () => {
    // A stage 2 POST cannot succeed on a stage 1 row — different expected
    // status. Returning 409 (not 400) is correct because the request is
    // structurally valid, just stale.
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage1' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        // u47: Stage 2 success requires `decision`. Use 'uncertain' so the
        // schema parses; the route should still 409 on the wrong stage.
        decision: 'uncertain',
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'work', confidence: 0.9 },
        },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('Fix [3]: error path with stale claim → 409, retry counter NOT incremented', async () => {
    // The error path also commits state changes (retries++); a stale POST
    // must not advance the retry counter on someone else's work.
    mockFindUnique.mockResolvedValue(makeItem({ status: 'pending_stage1' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'error',
        error_message: 'too late',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('Fix [3]: updateMany returns count=0 (lost row mid-flight) → 409 returned', async () => {
    // Belt-and-suspenders: even if the in-memory item.status check passed,
    // the compound `where` in updateMany guarantees the actual mutation only
    // commits when the row is still claimed. count=0 means the row was
    // mutated by a concurrent caller after our findUnique — return 409.
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage1' }) as never)
    mockUpdateMany.mockResolvedValue({ count: 0 } as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'keep',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('item_no_longer_claimed')
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
  })

  // ─── Review fix [7] — Stage 1 trace omitted optional fields preserved ──────
  it('Fix [7]: stage=1 success without `reason` preserves prior reason in trace', async () => {
    // Pre-fix: spreading data.reason=undefined into the trace overwrote the
    // previously-stored reason with null. Now the route conditionally
    // includes the field only if it was present in the body.
    mockFindUnique.mockResolvedValue(
      makeItem({
        classification_trace: {
          stage1: { decision: 'uncertain', confidence: 0.6, reason: 'prior attempt note' },
        },
      }) as never,
    )

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'keep',
        confidence: 0.9,
        // reason intentionally omitted — must NOT clobber prior 'prior attempt note'
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    const trace = updateArg.data.classification_trace as {
      stage1: { decision: string; confidence: number; reason: string }
    }
    expect(trace.stage1.decision).toBe('keep')
    expect(trace.stage1.confidence).toBe(0.9)
    // The PRESERVED reason — not undefined, not null
    expect(trace.stage1.reason).toBe('prior attempt note')
  })

  it('Fix [7]: stage=1 success without `confidence` preserves prior confidence', async () => {
    mockFindUnique.mockResolvedValue(
      makeItem({
        classification_trace: {
          stage1: { decision: 'uncertain', confidence: 0.55, reason: 'first try' },
        },
      }) as never,
    )

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'keep',
        // confidence omitted — must NOT clobber prior 0.55
        reason: 'second try',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    const trace = updateArg.data.classification_trace as {
      stage1: { decision: string; confidence: number; reason: string }
    }
    expect(trace.stage1.confidence).toBe(0.55) // preserved
    expect(trace.stage1.reason).toBe('second try') // overwritten
  })
})
