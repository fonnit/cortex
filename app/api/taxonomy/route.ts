import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

    const contexts = labels
      .filter(l => l.axis === 'context')
      .map(l => ({ name: l.name, count: l.item_count, lastUsed: l.last_used?.toISOString() ?? null }))

    return Response.json(
      { types, entities, contexts, mergeProposals },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[/api/taxonomy] Unexpected error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
