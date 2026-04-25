/**
 * GET /api/taxonomy/internal
 *
 * Phase 7 Plan 01, Task 3. Stage 2 consumer fetches the active taxonomy
 * each batch through this requireApiKey-guarded surface — Clerk is not
 * involved here. The existing Clerk-protected /api/taxonomy/route.ts is
 * untouched.
 *
 * Locked decisions (07-CONTEXT.md):
 *   - GET only — no POST/PATCH/DELETE/PUT (T-07-05).
 *   - requireApiKey at the very top of the handler (T-07-04), 401 with
 *     EMPTY body. Same shared-secret as ingest/queue/classify.
 *   - Filters out deprecated labels (`where: { deprecated: false }`) — the
 *     prisma schema has the column.
 *   - Cache-Control: no-store mirrors /api/taxonomy/route.ts (T-07-09).
 *   - 500 errors return a plain "Internal Server Error" string body — no
 *     schema hints, no stack traces.
 */

import type { NextRequest } from 'next/server'
import { requireApiKey } from '@/lib/api-key'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request)
  if (unauthorized) return unauthorized

  try {
    const labels = await prisma.taxonomyLabel.findMany({
      where: { deprecated: false },
      select: { axis: true, name: true },
    })

    const type = labels.filter((l) => l.axis === 'type').map((l) => l.name)
    const from = labels.filter((l) => l.axis === 'from').map((l) => l.name)
    const context = labels.filter((l) => l.axis === 'context').map((l) => l.name)

    return Response.json(
      { type, from, context },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[/api/taxonomy/internal]', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
