/**
 * GET /api/labels/samples
 *
 * Quick task 260428-lx4, Task 1. Stage 2 consumer (via the cortex MCP server)
 * fetches up to N most-recent confirmed-filed items carrying a particular axis
 * label, so Claude can ground its placement decision in real prior items.
 *
 * Locked decisions (lx4-PLAN, planner D1):
 *   - GET only — no POST/PATCH/DELETE/PUT.
 *   - requireApiKey at the very top, 401 with EMPTY body.
 *   - Filters: { status: 'filed', axis_<axis>: <label> } where axis is one of
 *     'type' | 'from'. SEED-v4-prod.md Decision 1 (260430-g6h) dropped the
 *     'context' axis from runtime — requests for axis=context return 400.
 *   - 400 (plain "Bad Request") when `axis` or `label` is missing/invalid.
 *   - Token-budget cap: limit ≤ 20 (default 5). Mirrors paths-internal's
 *     MAX_PATHS_RETURNED=50 — samples are higher-fan-out per call so the cap
 *     is tighter (T-lx4-04 mitigation).
 *   - Cache-Control: no-store mirrors /api/paths/internal.
 *   - 500 errors return plain "Internal Server Error" — no schema hints.
 *
 * Response shape:
 *   { samples: Array<{
 *       id, filename, confirmed_drive_path,
 *       axis_type, axis_from,
 *       ingested_at
 *     }> }
 *
 * The wrapping object lets us add fields later (e.g. as_of timestamp) without
 * breaking callers. ingested_at is serialized as an ISO string by Response.json.
 */

import type { NextRequest } from 'next/server'
import { requireApiKey } from '@/lib/api-key'
import { prisma } from '@/lib/prisma'
import { QUEUE_STATUSES } from '@/lib/queue-config'

/** Axis whitelist — Prisma's typed `where` won't accept dynamic key access. */
const ALLOWED_AXES = ['type', 'from'] as const
type AllowedAxis = (typeof ALLOWED_AXES)[number]

/**
 * Hard cap on samples returned per call. Samples are richer than paths-internal
 * parents — each row carries a filename + 3 axis labels + a path. A 20-row cap
 * keeps the MCP tool's token cost bounded even when the model asks for an
 * over-broad sample. Default of 5 is plenty for grounding.
 */
const MAX_SAMPLES = 20
const DEFAULT_SAMPLES = 5

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request)
  if (unauthorized) return unauthorized
  try { (await import('node:fs')).appendFileSync('/tmp/cortex-route-hits.log', `${new Date().toISOString()} GET ${request.url}\n`) } catch {}

  const url = new URL(request.url)
  const axis = url.searchParams.get('axis')
  const label = url.searchParams.get('label')

  // Validate axis ∈ whitelist.
  if (!axis || !ALLOWED_AXES.includes(axis as AllowedAxis)) {
    return new Response('Bad Request', { status: 400 })
  }
  // Validate label is present and non-empty.
  if (!label) {
    return new Response('Bad Request', { status: 400 })
  }

  // Parse + clamp limit.
  const limitRaw = url.searchParams.get('limit')
  const limitParsed = limitRaw ? Number.parseInt(limitRaw, 10) : DEFAULT_SAMPLES
  const limit =
    Number.isFinite(limitParsed) && limitParsed > 0
      ? Math.min(limitParsed, MAX_SAMPLES)
      : DEFAULT_SAMPLES

  try {
    // Static switch on axis so Prisma's typed `where` narrows correctly —
    // dynamic key access via `[`axis_${axis}`]` does not type-check against
    // the generated `where` input.
    const where = (() => {
      switch (axis as AllowedAxis) {
        case 'type':
          return { status: QUEUE_STATUSES.FILED, axis_type: label }
        case 'from':
          return { status: QUEUE_STATUSES.FILED, axis_from: label }
      }
    })()

    const rows = await prisma.item.findMany({
      where,
      orderBy: { ingested_at: 'desc' },
      take: limit,
      select: {
        id: true,
        filename: true,
        confirmed_drive_path: true,
        axis_type: true,
        axis_from: true,
        ingested_at: true,
      },
    })

    return Response.json(
      { samples: rows },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[/api/labels/samples]', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
