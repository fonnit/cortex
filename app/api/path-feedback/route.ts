/**
 * GET /api/path-feedback
 *
 * Quick task 260428-lx4, Task 1. Stage 2 consumer (via the cortex MCP server)
 * fetches recent user moves so Claude can learn where the user has been
 * re-filing items during triage.
 *
 * Locked decisions (lx4-PLAN, planner D1):
 *   - GET only — no POST/PATCH/DELETE/PUT.
 *   - requireApiKey at the very top, 401 with EMPTY body.
 *   - NO new PathCorrection table. Move signal is derived from the row-level
 *     diff between Item.proposed_drive_path and Item.confirmed_drive_path on
 *     status='filed' items. Prisma cannot express column-vs-column equality
 *     in a `where` without raw SQL, so we filter the equal-path rows out in
 *     JS after the query — acceptable for this small read path.
 *   - Default since = now - 30 days; default limit = 20; hard cap = 50.
 *   - 400 (plain "Bad Request") when `since` is provided but un-parseable.
 *   - Cache-Control: no-store on success.
 *   - 500 errors return plain "Internal Server Error".
 *
 * Response shape:
 *   { feedback: Array<{
 *       from_path: string  // proposed_drive_path (where Stage 2 wanted it)
 *       to_path: string    // confirmed_drive_path (where the user moved it)
 *       item_filename: string | null
 *       occurred_at: string // ingested_at (no separate move-timestamp column)
 *     }> }
 *
 * NOTE on `occurred_at` accuracy: there is no statusHistory column on Item, so
 * the precise wall-clock of the user's move is not recorded. ingested_at is a
 * useful proxy for the recency window — old moves drop off the 30-day window
 * naturally. A later iteration could write a moves table; out of scope here.
 */

import type { NextRequest } from 'next/server'
import { requireApiKey } from '@/lib/api-key'
import { prisma } from '@/lib/prisma'
import { QUEUE_STATUSES } from '@/lib/queue-config'

const MAX_FEEDBACK = 50
const DEFAULT_FEEDBACK = 20
const DEFAULT_SINCE_DAYS = 30

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request)
  if (unauthorized) return unauthorized
  try { (await import('node:fs')).appendFileSync('/tmp/cortex-route-hits.log', `${new Date().toISOString()} GET ${request.url}\n`) } catch {}

  const url = new URL(request.url)
  const sinceRaw = url.searchParams.get('since')
  const limitRaw = url.searchParams.get('limit')

  // Parse `since` if provided; reject un-parseable strings.
  let since: Date
  if (sinceRaw) {
    const parsed = Date.parse(sinceRaw)
    if (Number.isNaN(parsed)) {
      return new Response('Bad Request', { status: 400 })
    }
    since = new Date(parsed)
  } else {
    since = new Date(Date.now() - DEFAULT_SINCE_DAYS * 86_400_000)
  }

  // Parse + clamp limit.
  const limitParsed = limitRaw ? Number.parseInt(limitRaw, 10) : DEFAULT_FEEDBACK
  const limit =
    Number.isFinite(limitParsed) && limitParsed > 0
      ? Math.min(limitParsed, MAX_FEEDBACK)
      : DEFAULT_FEEDBACK

  try {
    const rows = await prisma.item.findMany({
      where: {
        status: QUEUE_STATUSES.FILED,
        confirmed_drive_path: { not: null },
        proposed_drive_path: { not: null },
        ingested_at: { gte: since },
      },
      orderBy: { ingested_at: 'desc' },
      take: limit,
      select: {
        filename: true,
        proposed_drive_path: true,
        confirmed_drive_path: true,
        ingested_at: true,
      },
    })

    // Filter rows where the user actually moved the item — Prisma cannot
    // express column-vs-column inequality without raw SQL.
    const feedback = rows
      .filter((r) => r.proposed_drive_path !== r.confirmed_drive_path)
      .map((r) => ({
        // After the {not: null} filter on both columns these are non-null at
        // runtime, but Prisma's generated types don't narrow accordingly.
        from_path: r.proposed_drive_path as string,
        to_path: r.confirmed_drive_path as string,
        item_filename: r.filename,
        occurred_at: r.ingested_at,
      }))

    return Response.json(
      { feedback },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[/api/path-feedback]', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
