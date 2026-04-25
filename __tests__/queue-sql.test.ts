/**
 * queue-sql tests
 *
 * Validates the param-builder helper that the route handler in plan 05-03
 * will use before tagging a `neon()` template. Tests exercise input
 * validation only — the actual SQL execution lives in the route handler
 * (and its integration test will run against pg-mem in plan 05-03).
 *
 * Per CONTEXT decisions: only stages 1 and 2 are valid; limit must be a
 * positive integer; the helper resolves the pending/processing status
 * strings from QUEUE_STATUSES (no string literals at the call site).
 */

import { buildClaimParams } from '../lib/queue-sql'

describe('buildClaimParams', () => {
  it('returns stage-1 status pair and echoed limit/stage for stage=1', () => {
    const params = buildClaimParams(1, 10)
    expect(params.pendingStatus).toBe('pending_stage1')
    expect(params.processingStatus).toBe('processing_stage1')
    // stageKey is now consumed by the route handler (review fix [6]) so the
    // test pins it as part of the helper's contract.
    expect(params.stageKey).toBe('stage1')
    expect(params.limit).toBe(10)
    expect(params.stage).toBe(1)
    expect(typeof params.nowIso).toBe('string')
  })

  it('returns stage-2 status pair for stage=2', () => {
    const params = buildClaimParams(2, 2)
    expect(params.pendingStatus).toBe('pending_stage2')
    expect(params.processingStatus).toBe('processing_stage2')
    expect(params.stageKey).toBe('stage2')
    expect(params.limit).toBe(2)
    expect(params.stage).toBe(2)
  })

  it('throws when stage is anything other than 1 or 2', () => {
    // Casting to any to bypass the Stage type — these are intentional
    // runtime-invalid inputs simulating a route-handler bug or attacker
    // payload that slipped past zod validation.
    expect(() => buildClaimParams(3 as any, 10)).toThrow(/Invalid stage/)
    expect(() => buildClaimParams(0 as any, 10)).toThrow(/Invalid stage/)
    expect(() => buildClaimParams('1' as any, 10)).toThrow(/Invalid stage/)
  })

  it('throws when limit is zero or negative', () => {
    expect(() => buildClaimParams(1, 0)).toThrow(/Invalid limit/)
    expect(() => buildClaimParams(1, -1)).toThrow(/Invalid limit/)
  })

  it('throws when limit is not an integer', () => {
    expect(() => buildClaimParams(1, 1.5)).toThrow(/Invalid limit/)
    expect(() => buildClaimParams(1, NaN)).toThrow(/Invalid limit/)
    expect(() => buildClaimParams(1, Infinity)).toThrow(/Invalid limit/)
  })

  it('returns a valid ISO 8601 timestamp string in nowIso', () => {
    const before = Date.now()
    const params = buildClaimParams(1, 10)
    const after = Date.now()
    const parsed = new Date(params.nowIso)
    expect(Number.isNaN(parsed.getTime())).toBe(false)
    // ISO 8601 round-trip: parsing and re-serializing should match.
    expect(parsed.toISOString()).toBe(params.nowIso)
    // Sanity: timestamp is in the [before, after] window.
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before)
    expect(parsed.getTime()).toBeLessThanOrEqual(after)
  })
})
