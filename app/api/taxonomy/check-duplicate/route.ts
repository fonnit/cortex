import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { labelSimilarity } from '@/lib/taxonomy-fuzzy'

const BLOCK_THRESHOLD = 0.85

export async function GET(req: Request) {
  try {
    const userId = await requireAuth()
    const url = new URL(req.url)
    const axis = url.searchParams.get('axis')
    const name = url.searchParams.get('name')
    if (!axis || !name) return Response.json({ error: 'axis and name required' }, { status: 400 })
    // SEED-v4-prod.md Decision 1 (260430-g6h): only 'type' and 'from' are
    // valid axes — 'context' was dropped from runtime.
    if (axis !== 'type' && axis !== 'from') {
      return Response.json({ error: 'invalid axis' }, { status: 400 })
    }

    const labels = await prisma.taxonomyLabel.findMany({
      where: { user_id: userId, axis, deprecated: false },
      select: { name: true },
    })

    let bestMatch: string | null = null
    let bestSim = 0
    for (const { name: existing } of labels) {
      if (existing.toLowerCase() === name.toLowerCase()) {
        return Response.json({ duplicate: true, match: existing, similarity: 1.0, exact: true })
      }
      const sim = labelSimilarity(existing, name)
      if (sim > bestSim) { bestSim = sim; bestMatch = existing }
    }

    if (bestSim >= BLOCK_THRESHOLD) {
      return Response.json({ duplicate: true, match: bestMatch, similarity: bestSim })
    }
    return Response.json({ duplicate: false, similarity: bestSim, match: bestMatch })
  } catch (err) {
    if (err instanceof Response) return err
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
