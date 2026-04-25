import { NextRequest } from 'next/server'
import { z } from 'zod'
import Langfuse from 'langfuse'
import { prisma } from '@/lib/prisma'
import { requireApiKey } from '@/lib/api-key'
import { QUEUE_STATUSES } from '@/lib/queue-config'

/**
 * Locked single-operator user id. Multi-user is explicitly out of scope for v1.1
 * per ROADMAP non-goals; tenancy schema is preserved (user_id column stays).
 * Override via env if a future tenant migration ever runs.
 */
const OWNER_USER_ID = process.env.CORTEX_OWNER_USER_ID ?? 'cortex_owner'

const IngestBodySchema = z.object({
  source: z.enum(['downloads', 'gmail']),
  content_hash: z.string().min(1),
  filename: z.string().optional(),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
  file_path: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request)
  if (unauthorized) return unauthorized

  const lf = new Langfuse()
  const trace = lf.trace({ name: 'api-ingest' })

  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      const res = Response.json(
        { error: 'validation_failed', issues: ['invalid_json'] },
        { status: 400 },
      )
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

    const parsed = IngestBodySchema.safeParse(body)
    if (!parsed.success) {
      const res = Response.json(
        { error: 'validation_failed', issues: parsed.error.issues },
        { status: 400 },
      )
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

    const {
      content_hash,
      source,
      filename,
      mime_type,
      size_bytes,
      source_metadata,
      file_path,
    } = parsed.data

    const dedupSpan = trace.span({ name: 'dedup-check', input: { content_hash } })
    const existing = await prisma.item.findUnique({ where: { content_hash } })
    dedupSpan.end({ output: { found: !!existing } })

    if (existing) {
      // Dedup hit — return existing id, NEVER call prisma.item.create
      const res = Response.json({ id: existing.id, deduped: true })
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

    // Persist file_path inside source_metadata so we don't need a new column.
    // Per CONTEXT: no schema changes beyond additive status string values.
    const mergedMetadata: Record<string, unknown> = {
      ...(source_metadata ?? {}),
      ...(file_path ? { file_path } : {}),
    }

    const createSpan = trace.span({ name: 'item-create', input: { source } })
    const hasMetadata = Object.keys(mergedMetadata).length > 0
    const created = await prisma.item.create({
      data: {
        user_id: OWNER_USER_ID,
        content_hash,
        source,
        status: QUEUE_STATUSES.PENDING_STAGE_1,
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
    res.headers.set('X-Trace-Id', trace.id)
    await lf.flushAsync()
    return res
  } catch (err) {
    console.error('[api/ingest] error:', err)
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
