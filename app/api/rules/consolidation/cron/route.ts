import { prisma } from '@/lib/prisma'

const CONSOLIDATION_THRESHOLD = 0.80

function tokenJaccard(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9→]+/).filter(Boolean))
  const ta = tokens(a)
  const tb = tokens(b)
  const intersection = [...ta].filter(t => tb.has(t)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const rules = await prisma.rule.findMany({
      where: { status: 'active' },
      select: { id: true, user_id: true, prefilter_bucket: true, text: true },
    })

    // Group by user_id + prefilter_bucket
    const groups = new Map<string, typeof rules>()
    for (const r of rules) {
      const key = `${r.user_id}:${r.prefilter_bucket}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    }

    const existing = await prisma.ruleConsolidationProposal.findMany({
      where: { status: 'pending' },
      select: { rule_a_id: true, rule_b_id: true },
    })
    const existingSet = new Set(
      existing.flatMap(e => [`${e.rule_a_id}:${e.rule_b_id}`, `${e.rule_b_id}:${e.rule_a_id}`])
    )

    const toCreate: {
      user_id: string
      rule_a_id: string
      rule_b_id: string
      evidence: string
      status: string
    }[] = []

    for (const [, group] of groups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i], b = group[j]
          const sim = tokenJaccard(a.text, b.text)
          if (sim < CONSOLIDATION_THRESHOLD) continue
          if (existingSet.has(`${a.id}:${b.id}`)) continue
          toCreate.push({
            user_id: a.user_id,
            rule_a_id: a.id,
            rule_b_id: b.id,
            evidence: `similarity ${(sim * 100).toFixed(0)}% · weekly scan`,
            status: 'pending',
          })
        }
      }
    }

    await prisma.ruleConsolidationProposal.createMany({ data: toCreate, skipDuplicates: true })
    return Response.json({ ok: true, created: toCreate.length })
  } catch (err) {
    console.error('[cron/consolidation]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
