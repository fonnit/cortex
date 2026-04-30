/**
 * POST /api/classify auto-file / auto-ignore / cold-start guard tests.
 *
 * Covers the path-based auto-file gate from quick task 260427-h9w
 * (which replaces u47-3's TaxonomyLabel-based allLabelsExist rule), the
 * auto-ignore branch from u47-2 (unchanged), and the Stage 1 + TOCTOU
 * regression cases that must keep working.
 *
 * Auto-file gate (post-h9w + post-260430-g6h two-axes contract):
 *   - decision='auto_file'
 *   - Both axis (type, from) confidences ≥ AUTO_FILE_THRESHOLD (0.85)
 *   - Both axis values are non-null
 *   - path_confidence is present and ≥ PATH_AUTO_FILE_MIN_CONFIDENCE (0.85)
 *   - Parent of proposed_drive_path has ≥ PATH_AUTO_FILE_MIN_SIBLINGS (3)
 *     confirmed-filed items in the database
 *
 * The TaxonomyLabel-based gate is GONE — axes can carry values that don't
 * exist in TaxonomyLabel without blocking auto-file. The new mock surface
 * is `prisma.item.count` instead of `prisma.taxonomyLabel.findMany`.
 */

// Mock Prisma BEFORE imports — we need item.count for the new sibling
// query and we explicitly verify that taxonomyLabel.findMany is NEVER
// called from this route anymore.
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
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
const mockItemCount = prisma.item.count as jest.MockedFunction<typeof prisma.item.count>
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
    axis_type_confidence: null,
    axis_from_confidence: null,
    proposed_drive_path: null,
    confirmed_drive_path: null,
    ...overrides,
  }
}

/** Default the sibling count to 0 (cold start). Tests opt into passing the gate. */
function mockSiblingCount(n: number) {
  mockItemCount.mockResolvedValue(n as never)
}

beforeEach(() => {
  process.env.CORTEX_API_KEY = 'test-secret'
  jest.clearAllMocks()
  mockUpdateMany.mockResolvedValue({ count: 1 } as never)
  mockSiblingCount(0)
})

/* ───────────────────────── AUTO-FILE branch (h9w + u47) ───────────────────────── */

describe('POST /api/classify — auto-file (h9w)', () => {
  it('H9W-1: happy path — auto_file + all axes ≥0.85 + path_confidence 0.9 + parent has 5 siblings → status=filed', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockSiblingCount(5)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        path_confidence: 0.9,
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
        },
        proposed_drive_path: '/fonnit/invoices/x.pdf',
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
    // Reversibility — axis_* + paths still written so triage can override.
    expect(updateArg.data.axis_type).toBe('invoice')
    expect(updateArg.data.axis_from).toBe('acme')
    expect(updateArg.data.proposed_drive_path).toBe('/fonnit/invoices/x.pdf')
    expect(updateArg.data.confirmed_drive_path).toBe('/fonnit/invoices/x.pdf')

    // New gate: prisma.item.count called with parent prefix + status='filed'.
    expect(mockItemCount).toHaveBeenCalledTimes(1)
    expect(mockItemCount).toHaveBeenCalledWith({
      where: {
        user_id: 'cortex_owner',
        status: 'filed',
        confirmed_drive_path: { startsWith: '/fonnit/invoices/' },
      },
    })
    // Old TaxonomyLabel gate is gone.
    expect(mockTaxonomyFindMany).not.toHaveBeenCalled()
  })

  it('H9W-2: blocked — path_confidence 0.7 < 0.85 → falls back to certain', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockSiblingCount(5)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        path_confidence: 0.7,
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
        },
        proposed_drive_path: '/fonnit/invoices/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('certain')

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.confirmed_drive_path).toBeUndefined()
    // Cheap blockers short-circuit before the count query runs.
    expect(mockItemCount).not.toHaveBeenCalled()
  })

  it('H9W-3: blocked — parent has 2 siblings (< 3) → falls back to certain', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockSiblingCount(2)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        path_confidence: 0.95,
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
        },
        proposed_drive_path: '/fonnit/invoices/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('certain')

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.confirmed_drive_path).toBeUndefined()
    expect(mockItemCount).toHaveBeenCalledTimes(1)
  })

  it('H9W-4: blocked — cold start (0 siblings) → falls back to certain', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockSiblingCount(0)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        path_confidence: 0.95,
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
        },
        proposed_drive_path: '/fonnit/invoices/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('certain')

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.confirmed_drive_path).toBeUndefined()
  })

  it('H9W-5: blocked — body missing path_confidence → no 400, just blocks auto_file (back-compat)', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockSiblingCount(5)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        // path_confidence intentionally omitted.
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
        },
        proposed_drive_path: '/fonnit/invoices/x.pdf',
      },
    })
    const res = await POST(req)
    // Wire-compat: no 400, just falls back.
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('certain')

    const updateArg = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data.confirmed_drive_path).toBeUndefined()
    expect(mockItemCount).not.toHaveBeenCalled()
  })

  it('H9W-6: NEW behavior — auto_file with axis value not in TaxonomyLabel still passes (label gate is gone)', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockSiblingCount(5)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        path_confidence: 0.9,
        axes: {
          // 'wholly_new_value' would have failed u47-3's allLabelsExist —
          // now allowed because the gate was replaced.
          type: { value: 'wholly_new_value', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
        },
        proposed_drive_path: '/fonnit/invoices/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('filed')

    // The whole point: TaxonomyLabel.findMany must NOT be called from this route.
    expect(mockTaxonomyFindMany).not.toHaveBeenCalled()
  })

  it('H9W-7: blocked — null axis with low confidence falls back to uncertain (axis-conf gate still applies)', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockSiblingCount(5)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        path_confidence: 0.9,
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: 'acme', confidence: 0.9 },
        },
        proposed_drive_path: '/?/acme/paid/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('uncertain')
    expect(json.status).not.toBe('filed')
    // Cheap blocker short-circuits before the count query.
    expect(mockItemCount).not.toHaveBeenCalled()
  })

  it('H9W-2b: blocked — axis below 0.85 even with valid path_confidence → falls back to certain', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockSiblingCount(5)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        path_confidence: 0.9,
        axes: {
          type: { value: 'invoice', confidence: 0.8 }, // below 0.85
          from: { value: 'acme', confidence: 0.9 },
        },
        proposed_drive_path: '/fonnit/invoices/x.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('certain')
    expect(mockItemCount).not.toHaveBeenCalled()
  })

  it('H9W-12: root edge — proposed_drive_path "/file.pdf" → parent "/", siblings ≥3 still fires (YAGNI)', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)
    mockSiblingCount(3)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        path_confidence: 0.9,
        axes: {
          type: { value: 'misc', confidence: 0.9 },
          from: { value: 'unknown', confidence: 0.9 },
        },
        proposed_drive_path: '/file.pdf',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('filed')

    expect(mockItemCount).toHaveBeenCalledWith({
      where: {
        user_id: 'cortex_owner',
        status: 'filed',
        confirmed_drive_path: { startsWith: '/' },
      },
    })
  })
})

/* ───────────────────────── AUTO-IGNORE branch (u47, unchanged) ───────────────────────── */

describe('POST /api/classify — auto-ignore (u47)', () => {
  it('H9W-8: happy path — decision=ignore + confidence ≥0.85 → status=ignored, count NOT consulted', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)

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
    expect(updateArg.data.confirmed_drive_path).toBeUndefined()
    // The new path-count query must NOT run for ignore.
    expect(mockItemCount).not.toHaveBeenCalled()
  })

  it('Test 6: blocked — decision=ignore + low confidence (<0.85) → falls back to uncertain', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'ignore',
        confidence: 0.6,
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.1 },
        },
        proposed_drive_path: '',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('uncertain')
    expect(json.status).not.toBe('ignored')
  })

  it('Test 7b: auto-ignore with no top-level confidence falls back to max(axis confidences)', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)

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
        },
        proposed_drive_path: '',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('uncertain')
  })
})

/* ───────────────── SCHEMA + REGRESSION ───────────────── */

describe('POST /api/classify — schema + regression', () => {
  it('H9W-13: decision=uncertain + all axes ≥0.85 → existing CERTAIN logic, no auto-action, no count query', async () => {
    mockFindUnique.mockResolvedValue(makeItem({ status: 'processing_stage2' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'uncertain',
        path_confidence: 0.9,
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
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
    expect(mockItemCount).not.toHaveBeenCalled()
  })

  it('H9W-11: stage=2 success without decision → 400 validation_failed', async () => {
    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        path_confidence: 0.9,
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
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

  it('H9W-9: Stage 1 path unaffected — keep/auto_file rejected on stage=1', async () => {
    // Stage 1 keep → pending_stage2.
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

    // Stage 1 with decision='auto_file' is structurally invalid.
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

  it('H9W-10: TOCTOU guard preserved — auto_file on item no longer in processing_stage2 → 409', async () => {
    // Item was reclaimed mid-flight; current status is 'pending_stage2'.
    mockFindUnique.mockResolvedValue(makeItem({ status: 'pending_stage2' }) as never)

    const req = makeRequest({
      body: {
        item_id: 'item_xyz',
        stage: 2,
        outcome: 'success',
        decision: 'auto_file',
        path_confidence: 0.9,
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
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
