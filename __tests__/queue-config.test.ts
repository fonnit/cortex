/**
 * queue-config tests
 *
 * Locks the literal numeric values and string identifiers used throughout
 * Phase 5 routes (ingest/queue/classify) and Phase 7 consumers. Keeping
 * these in one file means a future tuning pass touches one constant, not
 * scattered magic numbers.
 *
 * Source of truth: 05-CONTEXT.md decisions D-stale-timeout-10min,
 * D-retry-cap-5, and the queue state machine status string list.
 */

import {
  STALE_CLAIM_TIMEOUT_MS,
  RETRY_CAP,
  TERMINAL_ERROR_STATUS,
  QUEUE_TRACE_KEY,
  QUEUE_STATUSES,
} from '../lib/queue-config'

describe('queue-config constants', () => {
  it('STALE_CLAIM_TIMEOUT_MS equals 10 minutes in ms (600000)', () => {
    expect(STALE_CLAIM_TIMEOUT_MS).toBe(10 * 60 * 1000)
    expect(STALE_CLAIM_TIMEOUT_MS).toBe(600000)
  })

  it('RETRY_CAP equals 5', () => {
    expect(RETRY_CAP).toBe(5)
  })

  it("TERMINAL_ERROR_STATUS equals 'error'", () => {
    expect(TERMINAL_ERROR_STATUS).toBe('error')
  })

  it("QUEUE_TRACE_KEY equals 'queue'", () => {
    expect(QUEUE_TRACE_KEY).toBe('queue')
  })

  it('QUEUE_STATUSES literal strings match the v1.1 state machine', () => {
    expect(QUEUE_STATUSES.PENDING_STAGE_1).toBe('pending_stage1')
    expect(QUEUE_STATUSES.PROCESSING_STAGE_1).toBe('processing_stage1')
    expect(QUEUE_STATUSES.PENDING_STAGE_2).toBe('pending_stage2')
    expect(QUEUE_STATUSES.PROCESSING_STAGE_2).toBe('processing_stage2')
    expect(QUEUE_STATUSES.IGNORED).toBe('ignored')
    expect(QUEUE_STATUSES.UNCERTAIN).toBe('uncertain')
    expect(QUEUE_STATUSES.CERTAIN).toBe('certain')
    expect(QUEUE_STATUSES.ERROR).toBe('error')
    // Legacy v1.0 status — items with this value get reclaimed by the
    // one-shot stale-reclaim path in plan 05-03.
    expect(QUEUE_STATUSES.LEGACY_PROCESSING).toBe('processing')
  })

  it('TERMINAL_ERROR_STATUS and QUEUE_STATUSES.ERROR are the same value', () => {
    // Single source of truth for the terminal error string.
    expect(QUEUE_STATUSES.ERROR).toBe(TERMINAL_ERROR_STATUS)
  })
})
