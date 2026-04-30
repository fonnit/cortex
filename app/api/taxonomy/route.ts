import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export async function GET() {
  try {
    const userId = await requireAuth()

    const [labels, mergeProposals] = await Promise.all([
      prisma.taxonomyLabel.findMany({
        where: { user_id: userId },
        orderBy: { item_count: 'desc' },
      }),
      prisma.taxonomyMergeProposal.findMany({
        where: { user_id: userId, status: 'pending' },
        orderBy: { created_at: 'desc' },
      }),
    ])

    const types = labels
      .filter(l => l.axis === 'type')
      .map(l => ({ name: l.name, count: l.item_count, lastUsed: l.last_used?.toISOString() ?? null }))

    const entities = labels
      .filter(l => l.axis === 'from')
      .map(l => ({ name: l.name, count: l.item_count, lastUsed: l.last_used?.toISOString() ?? null }))

    // SEED-v4-prod.md Decision 1 (260430-g6h): no `contexts` array — the
    // context axis was dropped from runtime; only TaxonomyLabel rows from
    // before the strip would appear and we no longer surface them.
    return Response.json(
      { types, entities, mergeProposals },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[/api/taxonomy] Unexpected error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireAuth()
    const parsed = z.object({
      axis: z.enum(['type', 'from']),
      name: z.string().min(1).max(200),
    }).safeParse(await req.json())
    if (!parsed.success) {
      return Response.json(
        { error: 'validation_failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const { axis, name } = parsed.data
    await prisma.taxonomyLabel.create({
      data: { user_id: userId, axis, name, item_count: 0 },
    })
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[POST /api/taxonomy] Unexpected error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
