import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

function tokenJaccard(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9→]+/).filter(Boolean))
  const ta = tokens(a), tb = tokens(b)
  const intersection = [...ta].filter(t => tb.has(t)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

const PatchBody = z.object({
  text: z.string().min(1).max(500),
  confirm: z.boolean().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth()
    const { id } = await params
    const body = PatchBody.parse(await req.json())

    const rule = await prisma.rule.findUnique({ where: { id } })
    if (!rule || rule.user_id !== userId) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Conflict check: find rules in same bucket with new text similarity >= 0.85 (excluding this rule)
    const bucketRules = await prisma.rule.findMany({
      where: { user_id: userId, prefilter_bucket: rule.prefilter_bucket, id: { not: id } },
      select: { id: true, text: true },
    })
    const conflicts = bucketRules
      .map(r => ({ id: r.id, text: r.text, similarity: tokenJaccard(body.text, r.text) }))
      .filter(c => c.similarity >= 0.85)

    if (!body.confirm) {
      // Preview phase — no DB write
      return Response.json({
        preview: { old: rule.text, new: body.text },
        conflicts,
      })
    }

    // Confirm phase — commit update
    const updatedProvenance = `${rule.provenance} · edited (was: ${rule.text.slice(0, 60)}${rule.text.length > 60 ? '…' : ''})`
    await prisma.rule.update({
      where: { id },
      data: { text: body.text, provenance: updatedProvenance, updated_at: new Date() },
    })
    return Response.json({ ok: true, conflicts })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[PATCH /api/rules/[id]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth()
    const { id } = await params
    const rule = await prisma.rule.findUnique({ where: { id } })
    if (!rule || rule.user_id !== userId) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    // Soft delete: set status to 'dormant' to keep historical fire data
    await prisma.rule.update({ where: { id }, data: { status: 'dormant' } })
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
