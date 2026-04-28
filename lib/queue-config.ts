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

/**
 * Items strictly greater than this go straight to triage (status='uncertain');
 * smaller items go to Stage 2 (status='pending_stage2'). See quick task
 * 260428-jrt — Stage 1 was removed because Stage 2's `decision='ignore'`
 * already handles relevance signals, and large items (≥ 1 MiB) always went
 * to triage anyway because Stage 2's `claude -p` Read tool budget can't
 * read content beyond ~1 MiB.
 *
 * Exactly 1 MiB (1024 * 1024 = 1_048_576) — NOT 1_000_000. The threshold is
 * strict-greater-than: `size_bytes > TRIAGE_MIN_SIZE_BYTES`, so a file at
 * exactly 1 MiB still goes to Stage 2.
 */
export const TRIAGE_MIN_SIZE_BYTES = 1_048_576

/** Status string values used by the queue state machine. Additive — sit alongside existing v1.0 values. */
export const QUEUE_STATUSES = {
  /**
   * Retained for back-compat with in-flight items and the /api/queue
   * legacy-reclaim path; new ingests no longer produce this status
   * (quick task 260428-jrt).
   */
  PENDING_STAGE_1: 'pending_stage1',
  /**
   * Retained for back-compat with in-flight items and the /api/queue
   * legacy-reclaim path; new ingests no longer produce this status
   * (quick task 260428-jrt).
   */
  PROCESSING_STAGE_1: 'processing_stage1',
  PENDING_STAGE_2: 'pending_stage2',
  PROCESSING_STAGE_2: 'processing_stage2',
  IGNORED: 'ignored',
  UNCERTAIN: 'uncertain',
  CERTAIN: 'certain',
  /**
   * Terminal status set when Stage 2 returns decision='auto_file' with all
   * three axes ≥ AUTO_FILE_THRESHOLD AND every axis value already exists in
   * TaxonomyLabel (cold-start guard). Per quick task 260426-u47 (D-auto-file).
   * The 'filed' literal is already documented in prisma/schema.prisma's
   * Item.status doc-comment — only the constant is new here.
   */
  FILED: 'filed',
  ERROR: TERMINAL_ERROR_STATUS,
  /** Legacy v1.0 status — items in this state must be reclaimed to pending_stage1 or pending_stage2 by the stale-reclaim path. */
  LEGACY_PROCESSING: 'processing',
} as const
