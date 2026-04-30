import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const MergeBody = z.object({
  axis: z.enum(['type', 'from']),
  sources: z.array(z.string().min(1)).min(1),
  canonical: z.string().min(1),
})

// SEED-v4-prod.md Decision 1 (260430-g6h): 'context' axis dropped from runtime.
const AXIS_COL: Record<string, 'axis_type' | 'axis_from'> = {
  type: 'axis_type',
  from: 'axis_from',
}

export async function POST(req: Request) {
  try {
    const userId = await requireAuth()
    const parsed = MergeBody.safeParse(await req.json())
    if (!parsed.success) {
      return Response.json(
        { error: 'validation_failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const { axis, sources, canonical } = parsed.data

    const axisCol = AXIS_COL[axis]

    // Sources to delete: all source labels that are not the canonical
    const sourcesToDelete = sources.filter(s => s !== canonical)

    await prisma.$transaction([
      // Remap all items from any source label to canonical
      prisma.item.updateMany({
        where: { user_id: userId, [axisCol]: { in: sources } },
        data: { [axisCol]: canonical },
      }),
      // Delete merged-from TaxonomyLabel rows (exclude canonical if it exists)
      prisma.taxonomyLabel.deleteMany({
        where: {
          user_id: userId,
          axis,
          name: { in: sourcesToDelete },
        },
      }),
      // Create audit row
      prisma.taxonomyMergeProposal.create({
        data: {
          user_id: userId,
          axis,
          a: sources.join(', '),
          b: canonical,
          evidence: 'manual merge',
          suggested_canonical: canonical,
          status: 'accepted',
        },
      }),
    ])

    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[POST /api/taxonomy/merge]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
