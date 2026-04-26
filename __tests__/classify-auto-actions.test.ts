/**
 * POST /api/classify auto-file / auto-ignore / cold-start guard tests —
 * quick task 260426-u47.
 *
 * Validates Stage 2 terminal-action transitions per CONTEXT D-auto-file,
 * D-auto-ignore, D-cold-start:
 *
 *   - decision='auto_file' + 3 axes ≥ 0.85 + all values exist in
 *     TaxonomyLabel → status='filed' (terminal). axis_* + proposed_drive_path
 *     + confirmed_drive_path written for reversibility.
 *   - decision='ignore' + confidence ≥ 0.85 → status='ignored' (terminal).
 *     Cold-start guard does NOT apply (no labels committed).
 *   - decision='auto_file' but ANY axis value missing from TaxonomyLabel →
 *     auto-file BLOCKED, falls back to existing certain/uncertain semantics.
 *   - Stage 1 path unaffected (existing keep/ignore/uncertain transitions).
 *
 * Mirrors __tests__/classify-api.test.ts patterns: prisma mocked at the
 * module boundary (findUnique + updateMany + taxonomyLabel.findMany), Langfuse
 * stubbed with stable trace.id.
 */

// Mock Prisma BEFORE imports — extra surface vs classify-api.test.ts:
// taxonomyLabel.findMany is the cold-start guard's read.
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    taxonomyLabel: {
      findMany: jest.fn(),
    },
  },
}))

jest.mock('langfuse', () => {
  const span = { end: jest.fn() }
  const trace = { id: 'trace_test_auto', span: jest.fn(() => span) }
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

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item_xyz',
    user_id: 'cortex_owner',
    content_hash: 'hash_xyz',
    source: 'downloads',
    status: 'processing_stage2',
    classification_trace: null,
    axis_type: null,
    axis_from: null,
    axis_context: null,
    axis_type_confidence: null,
    axis_from_confidence: null,
    axis_context_confidence: null,
    proposed_drive_path: null,
    confirmed_drive_path: null,
    ...overrides,
  }
}

/** Helper: shape TaxonomyLabel rows for findMany mock. */
function tlabels(rows: Array<{ axis: 'type' | 'from' | 'context'; name: string }>) {
  return rows.map((r) => ({ axis: r.axis, name: r.name }))
}

const ALL_LABELS_PRESENT = tlabels([
  { axis: 'type', name: 'invoice' },
  { axis: 'from', name: 'acme' },
  { axis: 'context', name: 'paid' },
])

beforeEach(() => {
  process.env.CORTEX_API_KEY = 'test-secret'
  jest.clearAllMocks()
  mockUpdateMany.mockResolvedValue({ count: 1 } as never)
  mockTaxonomyFindMany.mockResolvedValue([] as never)
})

/* ───────────────────────── AUTO-FILE branch ───────────────────────── */

describe('POST /api/classify — auto-file (u47)', () => {
  it('Test 1: happy path — decision=auto_file, all axes ≥0.85, all labels exist → status=filed', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockTaxonomyFindMany.mockResolvedValue(ALL_LABELS_PRESENT as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/invoice/acme/paid/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.status).toBe('filed')

    expect(mockUpdateMany).toHaveBeenCalledTimes(1)
    const updateArg = mockUpdateMany.mock.calls[0][0] as {
      where: { id: string; status: string }
      data: Record<string, unknown>
    }
    expect(updateArg.where.status).toBe('processing_stage2')
    expect(updateArg.data.status).toBe('filed')
    // Reversibility: axis_* + proposed_drive_path STILL written so triage can override.
    expect(updateArg.data.axis_type).toBe('invoice')
    expect(updateArg.data.axis_from).toBe('acme')
    expect(updateArg.data.axis_context).toBe('paid')
    expect(updateArg.data.proposed_drive_path).toBe('/invoice/acme/paid/x.pdf')
    // Auto-file confirms the proposed path — confirmed_drive_path is set.
    expect(updateArg.data.confirmed_drive_path).toBe('/invoice/acme/paid/x.pdf')
    // Cold-start guard read against TaxonomyLabel for this user_id.
    expect(mockTaxonomyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: 'cortex_owner', deprecated: false }),
      }),
    )
  })

  it('Test 2: blocked — auto_file but one axis below 0.85 → falls back, status !== filed', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockTaxonomyFindMany.mockResolvedValue(ALL_LABELS_PRESENT as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        axes: {
          // type below 0.85 — blocks auto-file. All ≥0.75, so existing
          // CERTAIN/UNCERTAIN logic lands on 'certain'.
          type: { value: 'invoice', confidence: 0.8 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/invoice/acme/paid/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).not.toBe('filed')
    expect(json.status).toBe('certain')

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.confirmed_drive_path).toBeUndefined()
  })

  it('Test 3: blocked — cold-start guard, axis_type "newlabel" not in TaxonomyLabel → status !== filed', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    // 'invoice' for type is MISSING; 'newlabel' is what Claude proposed.
    mockTaxonomyFindMany.mockResolvedValue(
      tlabels([
        { axis: 'from', name: 'acme' },
        { axis: 'context', name: 'paid' },
      ]) as never,
    )

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        axes: {
          type: { value: 'newlabel', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/newlabel/acme/paid/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    // All ≥0.75 so the legacy fallback lands on 'certain', not 'filed'.
    expect(json.status).toBe('certain')
    expect(json.status).not.toBe('filed')

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    // confirmed_drive_path NOT set when auto-file is blocked.
    expect(updateArg.data.confirmed_drive_path).toBeUndefined()
  })

  it('Test 4: blocked — null axis value → falls back to uncertain (axis with confidence 0.1 < 0.75)', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockTaxonomyFindMany.mockResolvedValue(ALL_LABELS_PRESENT as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        axes: {
          type: { value: null, confidence: 0.1 }, // null + low confidence per AxisSchema refinement
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/?/acme/paid/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('uncertain')
    expect(json.status).not.toBe('filed')
  })
})

/* ───────────────────────── AUTO-IGNORE branch ───────────────────────── */

describe('POST /api/classify — auto-ignore (u47)', () => {
  it('Test 5: happy path — decision=ignore + confidence ≥0.85 → status=ignored, no axis writes, cold-start NOT consulted', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockTaxonomyFindMany.mockResolvedValue([] as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'ignore',
        confidence: 0.95,
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.1 },
          context: { value: null, confidence: 0.1 },
        },
        proposed_drive_path: '',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ignored')

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.status).toBe('ignored')
    // No confirmed_drive_path on ignore path.
    expect(updateArg.data.confirmed_drive_path).toBeUndefined()
  })

  it('Test 6: blocked — decision=ignore + low confidence (<0.85) → falls back, status=uncertain (no auto-ignore)', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockTaxonomyFindMany.mockResolvedValue([] as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'ignore',
        confidence: 0.6, // below AUTO_IGNORE_THRESHOLD (0.85)
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.1 },
          context: { value: null, confidence: 0.1 },
        },
        proposed_drive_path: '',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    // All-null + low confidence → existing logic lands on uncertain.
    expect(json.status).toBe('uncertain')
    expect(json.status).not.toBe('ignored')
  })

  it('Test 7: cold-start guard does NOT apply to auto-ignore — status=ignored even with empty TaxonomyLabel', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    // No labels at all — pre-bootstrap state.
    mockTaxonomyFindMany.mockResolvedValue([] as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'ignore',
        confidence: 0.9,
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.1 },
          context: { value: null, confidence: 0.1 },
        },
        proposed_drive_path: '',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ignored')
  })

  it('Test 7b: auto-ignore with no top-level confidence falls back to max(axis confidences) — fires when max ≥0.85', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockTaxonomyFindMany.mockResolvedValue([] as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'ignore',
        // No top-level confidence — route falls back to max(axis confidences).
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.1 },
          context: { value: null, confidence: 0.1 },
        },
        proposed_drive_path: '',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    // Max axis confidence = 0.1, well below 0.85 → no auto-ignore. Falls
    // back to existing 'uncertain' (all axes below 0.75 threshold).
    expect(json.status).toBe('uncertain')
  })
})

/* ───────────────── SCHEMA + REGRESSION ───────────────── */

describe('POST /api/classify — schema + regression (u47)', () => {
  it('Test 8: decision=uncertain + all axes ≥0.85 → existing CERTAIN logic (status=certain), no auto-action', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockTaxonomyFindMany.mockResolvedValue(ALL_LABELS_PRESENT as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'uncertain',
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/invoice/acme/paid/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('certain')

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.confirmed_drive_path).toBeUndefined()
  })

  it('Test 9: stage=2 success body WITHOUT decision → 400 validation_failed (decision is REQUIRED)', async () => {
    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        // decision intentionally omitted
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
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

  it('Test 10: Stage 1 path unaffected — keep/ignore/uncertain transitions unchanged; auto_file rejected on stage=1', async () => {
    // Stage 1 keep → pending_stage2
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage1' }) as never)

    const reqKeep = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'keep',
        confidence: 0.9,
      },
    })
    const resKeep = await POST(reqKeep)
    expect(resKeep.status).toBe(200)
    const jsonKeep = await resKeep.json()
    expect(jsonKeep.status).toBe('pending_stage2')

    // Stage 1 with decision='auto_file' is structurally invalid — rejected
    // by the Zod schema (Stage 1 enum stays keep/ignore/uncertain).
    jest.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 } as never)
    const reqBad = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 1,
        outcome: 'success',
        decision: 'auto_file',
        confidence: 0.9,
      },
    })
    const resBad = await POST(reqBad)
    expect(resBad.status).toBe(400)
    const jsonBad = await resBad.json()
    expect(jsonBad.error).toBe('validation_failed')
  })

  it('Test 11: TOCTOU guard preserved — auto_file on item no longer in processing_stage2 → 409', async () => {
    // Item was reclaimed mid-flight; current status is 'pending_stage2'.
    mockFindUnique.mockResolvedValue(makeItem({ status: 'pending_stage2' }) as never)
    mockTaxonomyFindMany.mockResolvedValue(ALL_LABELS_PRESENT as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('item_no_longer_claimed')
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })
})
