import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const PatchBody = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), newName: z.string().min(1).max(200) }),
  z.object({ op: z.literal('deprecate') }),
])

// SEED-v4-prod.md Decision 1 (260430-g6h): only 'type' and 'from' are valid;
// 'context' was dropped from runtime — the !axisCol guard 400s for it.
const AXIS_COL: Record<string, 'axis_type' | 'axis_from'> = {
  type: 'axis_type',
  from: 'axis_from',
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ axis: string; name: string }> }
) {
  try {
    const userId = await requireAuth()
    const { axis, name } = await params
    const decoded = decodeURIComponent(name)

    const axisCol = AXIS_COL[axis]
    if (!axisCol) return Response.json({ error: 'invalid axis' }, { status: 400 })

    const body = PatchBody.parse(await req.json())

    if (body.op === 'rename') {
      await prisma.$transaction([
        // Update all items that carry this label value
        prisma.item.updateMany({
          where: { user_id: userId, [axisCol]: decoded },
          data: { [axisCol]: body.newName },
        }),
        // Rename the TaxonomyLabel row
        prisma.taxonomyLabel.update({
          where: { user_id_axis_name: { user_id: userId, axis, name: decoded } },
          data: { name: body.newName },
        }),
      ])
    } else {
      // deprecate
      await prisma.taxonomyLabel.update({
        where: { user_id_axis_name: { user_id: userId, axis, name: decoded } },
        data: { deprecated: true },
      })
    }

    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[PATCH /api/taxonomy/[axis]/[name]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
