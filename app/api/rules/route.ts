import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const DORMANT_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000 // 60 days

function tokenJaccard(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9→]+/).filter(Boolean))
  const ta = tokens(a)
  const tb = tokens(b)
  const intersection = [...ta].filter(t => tb.has(t)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

export async function GET() {
  try {
    const userId = await requireAuth()

    const rules = await prisma.rule.findMany({
      where: { user_id: userId },
      orderBy: { fires: 'desc' },
    })

    const now = Date.now()
    const result = rules.map(rule => {
      const isDormant =
        rule.last_fired_at === null ||
        rule.last_fired_at.getTime() < now - DORMANT_THRESHOLD_MS
      return {
        id: rule.id,
        text: rule.text,
        fires: rule.fires,
        lastFired: rule.last_fired_at?.toISOString() ?? null,
        provenance: rule.provenance,
        status: isDormant ? 'dormant' : 'active',
      }
    })

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[/api/rules GET]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const PostSchema = z.object({
  text: z.string().min(1).max(500),
  prefilter_bucket: z.string().min(1),
  provenance: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const userId = await requireAuth()

    const body = PostSchema.safeParse(await req.json())
    if (!body.success) {
      return Response.json({ error: 'Invalid request', details: body.error.issues }, { status: 400 })
    }

    const { text, prefilter_bucket, provenance } = body.data

    // Hard cap: max 20 rules per prefilter_bucket per user
    const bucketCount = await prisma.rule.count({
      where: { user_id: userId, prefilter_bucket },
    })
    if (bucketCount >= 20) {
      return Response.json(
        { error: 'Hard cap: 20 rules per classification bucket', code: 'CAP_EXCEEDED' },
        { status: 422 }
      )
    }

    // Redundancy check: token-level Jaccard >= 0.85 signals redundant rule
    const bucketRules = await prisma.rule.findMany({
      where: { user_id: userId, prefilter_bucket },
      select: { id: true, text: true },
    })
    for (const existing of bucketRules) {
      const similarity = tokenJaccard(text, existing.text)
      if (similarity >= 0.85) {
        return Response.json(
          { error: 'Redundant rule', conflictsWith: existing.id, similarity },
          { status: 409 }
        )
      }
    }

    await prisma.rule.create({
      data: {
        user_id: userId,
        text,
        prefilter_bucket,
        provenance: provenance ?? 'manual',
      },
    })

    return Response.json({ ok: true }, { status: 201 })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[/api/rules POST]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
