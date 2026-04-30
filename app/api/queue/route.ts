import { NextRequest } from 'next/server'
import { z } from 'zod'
import Langfuse from 'langfuse'
import { neon } from '@neondatabase/serverless'
import { prisma } from '@/lib/prisma'
import { requireApiKey } from '@/lib/api-key'
import { STALE_CLAIM_TIMEOUT_MS, QUEUE_STATUSES } from '@/lib/queue-config'
import { buildClaimParams } from '@/lib/queue-sql'

/**
 * GET /api/queue?stage=1|2&limit=N
 *
 * Read/claim endpoint polled by Phase 7 consumers. On every call:
 *   1. STALE RECLAIM — items in processing_stage{N} whose last_claim_at is older
 *      than STALE_CLAIM_TIMEOUT_MS are moved back to pending_stage{N}.
 *   2. LEGACY RECLAIM — items still in v1.0 plain `processing` are routed back
 *      to either pending_stage2 (if classification_trace.stage2 exists) or
 *      pending_stage1, so the consumer doesn't redo Stage 1.
 *   3. ATOMIC CLAIM — single SQL statement using FOR UPDATE SKIP LOCKED so two
 *      parallel callers can never receive the same Item id (QUE-02 invariant).
 *
 * Response: { items: [...], reclaimed: number } where `reclaimed` is the
 * combined count of stage-stale + legacy items moved back to pending in this
 * call (so consumers can observe queue health).
 *
 * Auth: CORTEX_API_KEY shared-secret Bearer (mirrors /api/ingest, /api/classify).
 * Tracing: Langfuse trace `api-queue` with named spans on each step. The
 * X-Trace-Id header is set on every response so consumers can chain spans.
 */

const QuerySchema = z.object({
  stage: z.enum(['1', '2']),
  // limit must be a positive integer in [1, 100]. The 100 cap prevents a single
  // poller from pulling the whole table — T-05-16 mitigation.
  limit: z.coerce.number().int().min(1).max(100),
})

type ItemRow = {
  id: string
  source: string
  filename: string | null
  mime_type: string | null
  size_bytes: number | null
  content_hash: string
  source_metadata: Record<string, unknown> | null
}

export async function GET(request: NextRequest) {
  const tStart = Date.now()
  const unauthorized = requireApiKey(request)
  if (unauthorized) return unauthorized
  const tAfterAuth = Date.now()

  const lf = new Langfuse()
  const tAfterLfNew = Date.now()
  const trace = lf.trace({ name: 'api-queue' })
  const tAfterTrace = Date.now()

  try {
    const url = new URL(request.url)
    const parsed = QuerySchema.safeParse({
      stage: url.searchParams.get('stage'),
      limit: url.searchParams.get('limit'),
    })
    if (!parsed.success) {
      const res = Response.json(
        { error: 'validation_failed', issues: parsed.error.issues },
        { status: 400 },
      )
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

    const stageNum: 1 | 2 = parsed.data.stage === '1' ? 1 : 2
    // Single source of derivation for status strings, stageKey, and nowIso
    // (review fix [6]): the route used to recompute pendingStatus/
    // processingStatus/stageKey inline AND call buildClaimParams just for
    // nowIso. Now everything routes through the helper so a future rename
    // of QUEUE_STATUSES reaches one site, not two.
    const { pendingStatus, processingStatus, stageKey, limit, nowIso } = buildClaimParams(
      stageNum,
      parsed.data.limit,
    )

    const cutoffIso = new Date(Date.now() - STALE_CLAIM_TIMEOUT_MS).toISOString()

    // Transport choice: when DATABASE_URL points at Neon, use the neon()
    // HTTP adapter directly — each tagged-template call is a single HTTP
    // POST (~100ms). When it points at vanilla Postgres (local docker),
    // fall back to prisma.$transaction with the standard adapter.
    //
    // Why the split: the queue route runs on a hot polling loop (Mac agent
    // hits it every 5s). Empirically, prisma.$queryRaw with PrismaNeon's
    // WebSocket transport takes ~3s per call on Vercel — even inside a
    // $transaction — because the WS handshake fires per statement. With 3
    // statements that's ~9.5s, fast enough to saturate the agent's poll
    // cadence indefinitely. neon() HTTP brings the same 3 statements down
    // to ~500ms total in prod. The behavior locally is unchanged
    // (prisma.$transaction was already ~120ms warm against docker pg).
    //
    // Why not always use neon() HTTP: it requires Neon's specific HTTP API
    // and won't connect to a vanilla Postgres URL. The conditional keeps
    // local docker testing portable while making prod fast.
    //
    // Correctness: both branches preserve the original 3-statement order
    // (stale-reclaim → legacy-reclaim → atomic-claim). The atomic-claim's
    // FOR UPDATE SKIP LOCKED works under either transport — neon()
    // implicitly wraps each statement in a transaction; prisma.$transaction
    // makes the wrap explicit.
    const dbUrl = process.env.DATABASE_URL ?? ''
    const isNeon =
      dbUrl.includes('neon.tech') ||
      dbUrl.includes('.neon.') ||
      dbUrl.includes('pooler.')

    const reclaimSpan = trace.span({ name: 'stale-reclaim', input: { stage: stageNum, cutoffIso } })
    const legacySpan = trace.span({ name: 'legacy-reclaim', input: { cutoffIso } })
    const claimSpan = trace.span({ name: 'atomic-claim', input: { stage: stageNum, limit } })

    let staleRows: { id: string }[]
    let legacyRows: { id: string }[]
    let claimedRows: ItemRow[]

    let t0 = 0, t1 = 0, t2 = 0, t3 = 0
    if (isNeon) {
      const sql = neon(dbUrl)
      t0 = Date.now()
      // ─── 1) STALE RECLAIM (current stage) ──────────────────────────────────
      staleRows = (await sql`
        UPDATE "Item"
        SET status = ${pendingStatus}
        WHERE status = ${processingStatus}
          AND COALESCE(
                (classification_trace #>> ARRAY['queue', ${stageKey}, 'last_claim_at'])::timestamptz,
                ingested_at
              ) < ${cutoffIso}::timestamptz
        RETURNING id
      `) as { id: string }[]
      t1 = Date.now()
      // ─── 2) LEGACY RECLAIM (v1.0 plain `processing`) ───────────────────────
      legacyRows = (await sql`
        UPDATE "Item"
        SET status = CASE
          WHEN classification_trace ? 'stage2' THEN ${QUEUE_STATUSES.PENDING_STAGE_2}
          ELSE ${QUEUE_STATUSES.PENDING_STAGE_1}
        END
        WHERE status = ${QUEUE_STATUSES.LEGACY_PROCESSING}
          AND ingested_at < ${cutoffIso}::timestamptz
        RETURNING id
      `) as { id: string }[]
      t2 = Date.now()
      // ─── 3) ATOMIC CLAIM ────────────────────────────────────────────────────
      claimedRows = (await sql`
        UPDATE "Item"
        SET status = ${processingStatus},
            classification_trace = jsonb_set(
              jsonb_set(
                COALESCE(classification_trace, '{}'::jsonb),
                '{queue}',
                COALESCE(classification_trace->'queue', '{}'::jsonb),
                true
              ),
              ARRAY['queue', ${stageKey}, 'last_claim_at'],
              to_jsonb(${nowIso}::text),
              true
            )
        WHERE id IN (
          SELECT id FROM "Item"
          WHERE status = ${pendingStatus}
          ORDER BY ingested_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, source, filename, mime_type, size_bytes, content_hash, source_metadata
      `) as ItemRow[]
      t3 = Date.now()
    } else {
      // Local / non-Neon path — prisma.$transaction shares one connection
      // across all 3 statements. PrismaPg adapter is fast against docker pg.
      ;[staleRows, legacyRows, claimedRows] = await prisma.$transaction([
        prisma.$queryRaw<{ id: string }[]>`
          UPDATE "Item"
          SET status = ${pendingStatus}
          WHERE status = ${processingStatus}
            AND COALESCE(
                  (classification_trace #>> ARRAY['queue', ${stageKey}, 'last_claim_at'])::timestamptz,
                  ingested_at
                ) < ${cutoffIso}::timestamptz
          RETURNING id
        `,
        prisma.$queryRaw<{ id: string }[]>`
          UPDATE "Item"
          SET status = CASE
            WHEN classification_trace ? 'stage2' THEN ${QUEUE_STATUSES.PENDING_STAGE_2}
            ELSE ${QUEUE_STATUSES.PENDING_STAGE_1}
          END
          WHERE status = ${QUEUE_STATUSES.LEGACY_PROCESSING}
            AND ingested_at < ${cutoffIso}::timestamptz
          RETURNING id
        `,
        prisma.$queryRaw<ItemRow[]>`
          UPDATE "Item"
          SET status = ${processingStatus},
              classification_trace = jsonb_set(
                jsonb_set(
                  COALESCE(classification_trace, '{}'::jsonb),
                  '{queue}',
                  COALESCE(classification_trace->'queue', '{}'::jsonb),
                  true
                ),
                ARRAY['queue', ${stageKey}, 'last_claim_at'],
                to_jsonb(${nowIso}::text),
                true
              )
          WHERE id IN (
            SELECT id FROM "Item"
            WHERE status = ${pendingStatus}
            ORDER BY ingested_at ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id, source, filename, mime_type, size_bytes, content_hash, source_metadata
        `,
      ])
    }

    reclaimSpan.end({ output: { reclaimed: staleRows.length } })
    legacySpan.end({ output: { reclaimed: legacyRows.length } })
    claimSpan.end({ output: { claimed: claimedRows.length } })

    const items = claimedRows.map((row) => ({
      id: row.id,
      source: row.source,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      content_hash: row.content_hash,
      source_metadata: row.source_metadata,
      file_path:
        typeof row.source_metadata === 'object' &&
        row.source_metadata !== null &&
        'file_path' in row.source_metadata &&
        typeof (row.source_metadata as Record<string, unknown>).file_path === 'string'
          ? ((row.source_metadata as Record<string, unknown>).file_path as string)
          : null,
    }))

    const reclaimed = staleRows.length + legacyRows.length

    const tAfterSql = Date.now()
    const res = Response.json({ items, reclaimed })
    res.headers.set('X-Trace-Id', trace.id)
    res.headers.set('X-Debug-Transport', isNeon ? 'neon-http' : 'prisma')
    res.headers.set('X-Debug-Url-Hint', dbUrl.split('@')[1]?.split('/')[0] ?? 'no-url')
    if (isNeon) {
      res.headers.set('X-Debug-Timing', `stale=${t1-t0}ms legacy=${t2-t1}ms claim=${t3-t2}ms total=${t3-t0}ms`)
    }
    const tBeforeFlush = Date.now()
    // Skip awaiting flushAsync — fire-and-forget. The Langfuse trace is sent
    // best-effort; we don't need to block the response on it. This was the
    // ~9s tax on /api/queue: flushAsync awaits an HTTP POST to Langfuse cloud
    // which can be slow or hung under cold-start conditions. Other endpoints
    // (paths/internal etc.) appeared "fast" but were paying the same tax —
    // they're just less hot-path so it didn't matter.
    void lf.flushAsync().catch(() => { /* best-effort */ })
    const tAfterFlush = Date.now()
    res.headers.set('X-Debug-Pipeline', `auth=${tAfterAuth-tStart}ms lfNew=${tAfterLfNew-tAfterAuth}ms lfTrace=${tAfterTrace-tAfterLfNew}ms toSql=${t0-tAfterTrace}ms sql=${tAfterSql-t0}ms flush=${tAfterFlush-tBeforeFlush}ms`)
    return res
  } catch (err) {
    console.error('[api/queue] error:', err)
    try {
      await lf.flushAsync()
    } catch {
      /* noop — never let flush errors mask the original error */
    }
    const res = new Response('Internal Server Error', { status: 500 })
    res.headers.set('X-Trace-Id', trace.id)
    return res
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Internal SQL helpers — exported only for the pg-mem integration test.
 *
 * The route handler above now uses `prisma.$queryRaw` (tagged-template form)
 * for production paths against either PrismaNeon (Neon URL) or PrismaPg
 * (vanilla Postgres). These helpers retain positional ($1, $2, ...) parameter
 * SQL because pg-mem's pg-Client adapter takes positional params, not Prisma's
 * tagged-template form. They mirror the SAME SQL the route fires, so the
 * integration test can execute it without re-implementing the SQL string. If
 * the route SQL changes, update the helper below — the integration test will
 * catch any drift at the next run.
 *
 * Underscore-prefixed names mark these as test-only exports; do not import
 * them from production code.
 * ─────────────────────────────────────────────────────────────────────────── */

export function _atomicClaimSqlForTest(
  stage: 1 | 2,
  limit: number,
  nowIso: string,
): { text: string; values: unknown[] } {
  // Resolve status strings from QUEUE_STATUSES (review fix [5]) so a future
  // rename of any literal forces a recompile here, not a silent test drift.
  const stageKey = stage === 1 ? 'stage1' : 'stage2'
  const pendingStatus =
    stage === 1 ? QUEUE_STATUSES.PENDING_STAGE_1 : QUEUE_STATUSES.PENDING_STAGE_2
  const processingStatus =
    stage === 1 ? QUEUE_STATUSES.PROCESSING_STAGE_1 : QUEUE_STATUSES.PROCESSING_STAGE_2
  return {
    text: `
      UPDATE "Item"
      SET status = $1,
          classification_trace = jsonb_set(
            jsonb_set(
              COALESCE(classification_trace, '{}'::jsonb),
              '{queue}',
              COALESCE(classification_trace->'queue', '{}'::jsonb),
              true
            ),
            ARRAY['queue', $2::text, 'last_claim_at'],
            to_jsonb($3::text),
            true
          )
      WHERE id IN (
        SELECT id FROM "Item"
        WHERE status = $4
        ORDER BY ingested_at ASC
        LIMIT $5
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, status, classification_trace
    `,
    values: [processingStatus, stageKey, nowIso, pendingStatus, limit],
  }
}

export function _staleReclaimSqlForTest(
  stage: 1 | 2,
  cutoffIso: string,
): { text: string; values: unknown[] } {
  const stageKey = stage === 1 ? 'stage1' : 'stage2'
  const pendingStatus =
    stage === 1 ? QUEUE_STATUSES.PENDING_STAGE_1 : QUEUE_STATUSES.PENDING_STAGE_2
  const processingStatus =
    stage === 1 ? QUEUE_STATUSES.PROCESSING_STAGE_1 : QUEUE_STATUSES.PROCESSING_STAGE_2
  return {
    text: `
      UPDATE "Item"
      SET status = $1
      WHERE status = $2
        AND COALESCE(
              (classification_trace #>> ARRAY['queue', $3::text, 'last_claim_at'])::timestamptz,
              ingested_at
            ) < $4::timestamptz
      RETURNING id, status
    `,
    values: [pendingStatus, processingStatus, stageKey, cutoffIso],
  }
}

export function _legacyReclaimSqlForTest(cutoffIso: string): { text: string; values: unknown[] } {
  // The CASE branches are interpolated from QUEUE_STATUSES so a rename of
  // PENDING_STAGE_1 / PENDING_STAGE_2 / LEGACY_PROCESSING reaches the test
  // helper. The values are constants from a `as const` map, so this is a
  // build-time string concat — no SQL injection surface.
  return {
    text: `
      UPDATE "Item"
      SET status = CASE
        WHEN classification_trace ? 'stage2' THEN '${QUEUE_STATUSES.PENDING_STAGE_2}'
        ELSE '${QUEUE_STATUSES.PENDING_STAGE_1}'
      END
      WHERE status = '${QUEUE_STATUSES.LEGACY_PROCESSING}'
        AND ingested_at < $1::timestamptz
      RETURNING id, status
    `,
    values: [cutoffIso],
  }
}
