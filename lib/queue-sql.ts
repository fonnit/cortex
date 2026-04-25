import { QUEUE_STATUSES } from './queue-config'

export type Stage = 1 | 2
export type StageKey = 'stage1' | 'stage2'

/**
 * Build the atomic claim params for `GET /api/queue?stage=N&limit=L`.
 *
 * The route handler in app/api/queue/route.ts owns the static SQL because
 * `@neondatabase/serverless`'s `neon()` requires the tagged-template form
 * for parameter binding — a string-returning builder cannot be
 * parameterized. This helper resolves the pending/processing status
 * strings, the stageKey ('stage1'|'stage2'), and a fresh ISO timestamp
 * from the canonical QUEUE_STATUSES map so callers cannot hand-roll typos
 * like 'pending_stage_1' or 'stage_1'. After review fix [6] the route now
 * consumes ALL fields from this helper — keeping it as the single source
 * of derivation so a future rename of QUEUE_STATUSES reaches one site, not
 * two.
 *
 * Caller usage (in app/api/queue/route.ts):
 *   const { pendingStatus, processingStatus, stageKey, limit, nowIso } =
 *     buildClaimParams(stageNum, limitNum)
 *   const sql = neon(process.env.DATABASE_URL!)
 *   const rows = await sql`
 *     UPDATE "Item"
 *     SET status = ${processingStatus},
 *         classification_trace = jsonb_set(
 *           jsonb_set(
 *             COALESCE(classification_trace, '{}'::jsonb),
 *             '{queue}',
 *             COALESCE(classification_trace->'queue', '{}'::jsonb),
 *             true
 *           ),
 *           ARRAY['queue', ${stageKey}::text, 'last_claim_at'],
 *           to_jsonb(${nowIso}::text),
 *           true
 *         )
 *     WHERE id IN (
 *       SELECT id FROM "Item"
 *       WHERE status = ${pendingStatus}
 *       ORDER BY ingested_at ASC
 *       LIMIT ${limit}
 *       FOR UPDATE SKIP LOCKED
 *     )
 *     RETURNING *
 *   `
 *
 * The `FOR UPDATE SKIP LOCKED` clause is what guarantees two parallel
 * callers never receive the same Item id — the inner SELECT locks the
 * candidate rows and any concurrent transaction silently skips them.
 *
 * The defensive validation (stage in {1,2}, limit positive integer) is
 * kept as defence-in-depth even though Zod validates upstream — the
 * helper is exported and could be invoked from a test or a future caller
 * that doesn't go through the route's Zod parser.
 */
export function buildClaimParams(
  stage: Stage,
  limit: number,
): {
  pendingStatus: string
  processingStatus: string
  stageKey: StageKey
  limit: number
  nowIso: string
  stage: Stage
} {
  if (stage !== 1 && stage !== 2) {
    throw new Error(`Invalid stage: ${stage}. Must be 1 or 2.`)
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid limit: ${limit}. Must be a positive integer.`)
  }
  const pendingStatus =
    stage === 1 ? QUEUE_STATUSES.PENDING_STAGE_1 : QUEUE_STATUSES.PENDING_STAGE_2
  const processingStatus =
    stage === 1
      ? QUEUE_STATUSES.PROCESSING_STAGE_1
      : QUEUE_STATUSES.PROCESSING_STAGE_2
  const stageKey: StageKey = stage === 1 ? 'stage1' : 'stage2'
  return {
    pendingStatus,
    processingStatus,
    stageKey,
    limit,
    nowIso: new Date().toISOString(),
    stage,
  }
}
