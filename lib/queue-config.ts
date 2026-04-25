/**
 * Queue tuning constants — single source of truth for stale-claim and retry semantics.
 * Per CONTEXT decisions D-stale-timeout-10min and D-retry-cap-5.
 */

/** Items in processing_stageN longer than this are reclaimed to pending_stageN on the next /api/queue poll. */
export const STALE_CLAIM_TIMEOUT_MS = 10 * 60 * 1000

/** After RETRY_CAP failed attempts at a stage, the item moves to TERMINAL_ERROR_STATUS instead of pending. */
export const RETRY_CAP = 5

/** Terminal status string written to Item.status when an item exceeds RETRY_CAP. */
export const TERMINAL_ERROR_STATUS = 'error' as const

/** JSON sibling key under classification_trace where queue metadata (retries, last_claim_at, last_error) lives. */
export const QUEUE_TRACE_KEY = 'queue' as const

/** Status string values used by the queue state machine. Additive — sit alongside existing v1.0 values. */
export const QUEUE_STATUSES = {
  PENDING_STAGE_1: 'pending_stage1',
  PROCESSING_STAGE_1: 'processing_stage1',
  PENDING_STAGE_2: 'pending_stage2',
  PROCESSING_STAGE_2: 'processing_stage2',
  IGNORED: 'ignored',
  UNCERTAIN: 'uncertain',
  CERTAIN: 'certain',
  ERROR: TERMINAL_ERROR_STATUS,
  /** Legacy v1.0 status — items in this state must be reclaimed to pending_stage1 or pending_stage2 by the stale-reclaim path. */
  LEGACY_PROCESSING: 'processing',
} as const
