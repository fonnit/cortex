/**
 * GET /api/paths/internal
 *
 * Quick task 260427-h9w, Task 1. Stage 2 consumer fetches the existing
 * confirmed-folder tree each batch through this requireApiKey-guarded surface
 * — Clerk is not involved here. The endpoint mirrors /api/taxonomy/internal
 * exactly in posture (auth, GET-only, 500 wording, Cache-Control).
 *
 * Locked decisions (h9w-CONTEXT.md):
 *   - GET only — no POST/PATCH/DELETE/PUT.
 *   - requireApiKey at the very top of the handler, 401 with EMPTY body.
 *     Same shared-secret as ingest/queue/classify/taxonomy.
 *   - Filters: `status='filed' AND confirmed_drive_path IS NOT NULL`. Only
 *     items the user (or auto-file) has actually committed to a Drive path
 *     contribute to the tree. Items in pending_stage2 / uncertain may carry a
 *     provisional `proposed_drive_path` but those are intentionally NOT shown
 *     to Claude — they'd pollute the tree with unsettled proposals.
 *   - In-memory parent extraction: drop everything after the LAST `/`. So
 *     `/fonnit/invoices/2024/jan-acme.pdf` → `/fonnit/invoices/2024/`.
 *     `/file.pdf` → `/` (root edge case — included; YAGNI per CONTEXT, since
 *     auto-file at root requires PATH_AUTO_FILE_MIN_SIBLINGS items there).
 *   - Token-budget cap: top-50 parents by file count. The Stage 2 prompt
 *     injects this list, so an unbounded payload would balloon the prompt
 *     argv (T-h9w-02 mitigation).
 *   - Cache-Control: no-store mirrors /api/taxonomy/internal.
 *   - 500 errors return a plain "Internal Server Error" string body — no
 *     schema hints, no stack traces.
 *
 * Response shape:
 *   { paths: Array<{ parent: string; count: number }> }   // count desc, ≤50
 *
 * The wrapping object (rather than a bare array) lets us add fields later
 * (e.g. `as_of` timestamp, total parent count) without breaking clients.
 */

import type { NextRequest } from 'next/server'
import { requireApiKey } from '@/lib/api-key'
import { prisma } from '@/lib/prisma'
import { QUEUE_STATUSES } from '@/lib/queue-config'

/**
 * Hard cap on parents returned. The Stage 2 prompt injects this list verbatim;
 * a 50-row cap keeps the prompt-byte budget bounded even when the user has
 * filed thousands of items across hundreds of folders. Pick the top-50 by
 * count — those are the folders Claude is most likely to find a match in.
 */
const MAX_PATHS_RETURNED = 50

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request)
  if (unauthorized) return unauthorized

  try {
    // TODO(v1.2): scope by request user_id once multi-tenant. For now this
    // matches /api/taxonomy/internal's posture — single-operator tool.
    const rows = await prisma.item.findMany({
      where: {
        status: QUEUE_STATUSES.FILED,
        confirmed_drive_path: { not: null },
      },
      select: { confirmed_drive_path: true },
    })

    // Bucket by parent (drop everything after the last '/'). Edge case:
    // `/file.pdf` → parent `/` (root). Documented YAGNI — auto-file at root
    // requires the same ≥3 sibling threshold so it cannot fire spuriously.
    const counts = new Map<string, number>()
    for (const row of rows) {
      const path = row.confirmed_drive_path
      if (!path) continue
      const lastSlash = path.lastIndexOf('/')
      const parent = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : '/'
      counts.set(parent, (counts.get(parent) ?? 0) + 1)
    }

    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PATHS_RETURNED)
      .map(([parent, count]) => ({ parent, count }))

    return Response.json(
      { paths: sorted },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[/api/paths/internal]', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
