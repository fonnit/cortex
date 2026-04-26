import { NextRequest } from 'next/server'
import { z } from 'zod'
import Langfuse from 'langfuse'
import { prisma } from '@/lib/prisma'
import { requireApiKey } from '@/lib/api-key'
import { QUEUE_STATUSES, STAGE1_MIN_SIZE_BYTES } from '@/lib/queue-config'

/**
 * Locked single-operator user id. Multi-user is explicitly out of scope for v1.1
 * per ROADMAP non-goals; tenancy schema is preserved (user_id column stays).
 * Override via env if a future tenant migration ever runs.
 */
const OWNER_USER_ID = process.env.CORTEX_OWNER_USER_ID ?? 'cortex_owner'

/**
 * Ingest body schema.
 *
 * Two shapes are accepted (Phase 6 Plan 01):
 * 1. Standard ingest: { source, content_hash, ...optional metadata } — creates an Item.
 * 2. Heartbeat ping:  { heartbeat: true } — connectivity probe, short-circuits to 204.
 *
 * `source` and `content_hash` are declared optional at the field level so that the
 * heartbeat shape passes Zod parsing; the `.refine()` enforces them when `heartbeat`
 * is not set. Existing 400-validation tests stay green because a body that's missing
 * BOTH `heartbeat` and (`source` | `content_hash`) still fails the refine.
 */
const IngestBodySchema = z
  .object({
    source: z.enum(['downloads', 'gmail']).optional(),
    content_hash: z.string().min(1).optional(),
    filename: z.string().optional(),
    mime_type: z.string().optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    source_metadata: z.record(z.string(), z.unknown()).optional(),
    file_path: z.string().optional(),
    heartbeat: z.literal(true).optional(),
  })
  .refine(
    (b) => b.heartbeat === true || (b.source !== undefined && b.content_hash !== undefined),
    { message: 'source and content_hash are required when heartbeat is not set' },
  )

/**
 * Routing decision (quick task 260426-u47, D-stage1-routing).
 *
 * Decides the initial Item.status at ingest time so that small / metadata-only
 * items skip Stage 1 (the expensive relevance gate) and go straight to Stage 2.
 *
 * Rules:
 *   - source='downloads': size_bytes > STAGE1_MIN_SIZE_BYTES → PENDING_STAGE_1.
 *     If size_bytes is undefined (unknown — could be huge), default to
 *     PENDING_STAGE_1 (safe default that preserves the v1.1 behavior for
 *     size-less items).
 *   - source='gmail': inspect source_metadata.attachments. If any attachment
 *     has a numeric size_bytes > STAGE1_MIN_SIZE_BYTES → PENDING_STAGE_1.
 *     Otherwise (no attachments / all small / malformed) → PENDING_STAGE_2.
 *
 * Defensive (T-u47-01): malformed source_metadata.attachments (non-array,
 * non-numeric size_bytes, missing keys) MUST NOT throw — treat as "no large
 * attachment found" and route to PENDING_STAGE_2.
 */
function computeInitialStatus(input: {
  source: 'downloads' | 'gmail'
  size_bytes?: number
  source_metadata?: Record<string, unknown>
}): typeof QUEUE_STATUSES.PENDING_STAGE_1 | typeof QUEUE_STATUSES.PENDING_STAGE_2 {
  if (input.source === 'downloads') {
    if (typeof input.size_bytes === 'number' && input.size_bytes > STAGE1_MIN_SIZE_BYTES) {
      return QUEUE_STATUSES.PENDING_STAGE_1
    }
    if (input.size_bytes === undefined) {
      // Unknown size — treat as "potentially large" and route through Stage 1.
      return QUEUE_STATUSES.PENDING_STAGE_1
    }
    return QUEUE_STATUSES.PENDING_STAGE_2
  }
  // gmail
  const attachments = input.source_metadata?.attachments
  if (!Array.isArray(attachments)) {
    // Missing/malformed attachments key → treat as "no attachments" → Stage 2.
    return QUEUE_STATUSES.PENDING_STAGE_2
  }
  const hasLarge = attachments.some((a) => {
    if (a === null || typeof a !== 'object') return false
    const sz = (a as Record<string, unknown>).size_bytes
    return typeof sz === 'number' && sz > STAGE1_MIN_SIZE_BYTES
  })
  return hasLarge ? QUEUE_STATUSES.PENDING_STAGE_1 : QUEUE_STATUSES.PENDING_STAGE_2
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request)
  if (unauthorized) return unauthorized

  const lf = new Langfuse()
  // The trace is created lazily — after we know the body is NOT a heartbeat ping.
  // Per CONTEXT D-heartbeat: every-60s liveness probes must not flood Langfuse.
  let trace: ReturnType<typeof lf.trace> | null = null
  const ensureTrace = () => (trace ??= lf.trace({ name: 'api-ingest' }))

  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      const t = ensureTrace()
      const res = Response.json(
        { error: 'validation_failed', issues: ['invalid_json'] },
        { status: 400 },
      )
      res.headers.set('X-Trace-Id', t.id)
      await lf.flushAsync()
      return res
    }

    const parsed = IngestBodySchema.safeParse(body)
    if (!parsed.success) {
      const t = ensureTrace()
      const res = Response.json(
        { error: 'validation_failed', issues: parsed.error.issues },
        { status: 400 },
      )
      res.headers.set('X-Trace-Id', t.id)
      await lf.flushAsync()
      return res
    }

    // ---- Heartbeat short-circuit (Phase 6 Plan 01) ----
    // Per CONTEXT D-heartbeat: a daemon liveness ping returns 204 No Content with
    // no Item write and NO Langfuse span work — every poll cycle (60s) calls this,
    // and tracing each one would flood Langfuse. The only daemon→server liveness
    // signal that gets traced is the daemon-side `daemon-heartbeat` trace (every
    // 5 min, emitted by the daemon, not by this route).
    //
    // We deliberately do not set X-Trace-Id (no span exists on this path) and we
    // do not call lf.flushAsync() (no spans were created — flush is unnecessary).
    if (parsed.data.heartbeat === true) {
      return new Response(null, { status: 204 })
    }

    // Past the heartbeat branch — open the trace for the actual ingest work.
    const t = ensureTrace()

    // Past this point the refine guarantees source + content_hash are present.
    const {
      content_hash,
      source,
      filename,
      mime_type,
      size_bytes,
      source_metadata,
      file_path,
    } = parsed.data as {
      content_hash: string
      source: 'downloads' | 'gmail'
      filename?: string
      mime_type?: string
      size_bytes?: number
      source_metadata?: Record<string, unknown>
      file_path?: string
    }

    const dedupSpan = t.span({ name: 'dedup-check', input: { content_hash } })
    const existing = await prisma.item.findUnique({ where: { content_hash } })
    dedupSpan.end({ output: { found: !!existing } })

    if (existing) {
      // Dedup hit — return existing id, NEVER call prisma.item.create
      const res = Response.json({ id: existing.id, deduped: true })
      res.headers.set('X-Trace-Id', t.id)
      await lf.flushAsync()
      return res
    }

    // Persist file_path inside source_metadata so we don't need a new column.
    // Per CONTEXT: no schema changes beyond additive status string values.
    const mergedMetadata: Record<string, unknown> = {
      ...(source_metadata ?? {}),
      ...(file_path ? { file_path } : {}),
    }

    // Routing decision (quick task 260426-u47, D-stage1-routing).
    // Small / metadata-only items skip Stage 1 (the expensive relevance gate)
    // and go straight to Stage 2. The decision is observable per-item via the
    // `route-decision` Langfuse span so we can audit which items took which path.
    const routeSpan = t.span({
      name: 'route-decision',
      input: { source, size_bytes },
    })
    const initialStatus = computeInitialStatus({ source, size_bytes, source_metadata })
    routeSpan.end({ output: { status: initialStatus } })

    const createSpan = t.span({ name: 'item-create', input: { source } })
    const hasMetadata = Object.keys(mergedMetadata).length > 0
    const created = await prisma.item.create({
      data: {
        user_id: OWNER_USER_ID,
        content_hash,
        source,
        status: initialStatus,
        filename: filename ?? null,
        mime_type: mime_type ?? null,
        size_bytes: size_bytes ?? null,
        // Prisma's Json input type expects InputJsonValue; the Record<string, unknown>
        // shape is structurally compatible — cast at the boundary.
        ...(hasMetadata ? { source_metadata: mergedMetadata as object } : {}),
      },
    })
    createSpan.end({ output: { id: created.id } })

    const res = Response.json({ id: created.id, deduped: false })
    res.headers.set('X-Trace-Id', t.id)
    await lf.flushAsync()
    return res
  } catch (err) {
    console.error('[api/ingest] error:', err)
    // On the error path, ensure a trace exists so the X-Trace-Id header is still set
    // (matches the pre-Plan-06-01 behaviour: every error path carries a trace id).
    const t = ensureTrace()
    try {
      await lf.flushAsync()
    } catch {
      /* noop — never let flush errors mask the original error */
    }
    const res = new Response('Internal Server Error', { status: 500 })
    res.headers.set('X-Trace-Id', t.id)
    return res
  }
}
