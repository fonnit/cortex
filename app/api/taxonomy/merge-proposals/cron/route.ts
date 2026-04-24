import { prisma } from '@/lib/prisma'
import { labelSimilarity } from '@/lib/taxonomy-fuzzy'

const PROPOSAL_THRESHOLD = 0.82

export async function POST(req: Request) {
  // Vercel cron authorization
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    // Fetch all non-deprecated labels grouped by user_id + axis
    const labels = await prisma.taxonomyLabel.findMany({
      where: { deprecated: false },
      select: { user_id: true, axis: true, name: true },
    })

    // Group by user_id + axis
    const groups = new Map<string, { axis: string; user_id: string; names: string[] }>()
    for (const l of labels) {
      const key = `${l.user_id}:${l.axis}`
      if (!groups.has(key)) groups.set(key, { axis: l.axis, user_id: l.user_id, names: [] })
      groups.get(key)!.names.push(l.name)
    }

    // Fetch all existing pending proposals to avoid duplicates
    const existing = await prisma.taxonomyMergeProposal.findMany({
      where: { status: 'pending' },
      select: { user_id: true, axis: true, a: true, b: true },
    })
    const existingSet = new Set(existing.map(e => `${e.user_id}:${e.axis}:${e.a}:${e.b}`))

    const toCreate: Parameters<typeof prisma.taxonomyMergeProposal.create>[0]['data'][] = []

    for (const [, { user_id, axis, names }] of groups) {
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const a = names[i], b = names[j]
          const sim = labelSimilarity(a, b)
          if (sim < PROPOSAL_THRESHOLD) continue
          const fwdKey = `${user_id}:${axis}:${a}:${b}`
          const revKey = `${user_id}:${axis}:${b}:${a}`
          if (existingSet.has(fwdKey) || existingSet.has(revKey)) continue
          // Suggest longer name as canonical (usually more specific)
          const canonical = a.length >= b.length ? a : b
          toCreate.push({
            user_id, axis, a, b,
            evidence: `similarity ${(sim * 100).toFixed(0)}% · nightly scan`,
            suggested_canonical: canonical,
            status: 'pending',
          })
        }
      }
    }

    // createMany in batches of 50
    let created = 0
    for (let i = 0; i < toCreate.length; i += 50) {
      const batch = toCreate.slice(i, i + 50)
      await prisma.taxonomyMergeProposal.createMany({ data: batch as any, skipDuplicates: true })
      created += batch.length
    }

    return Response.json({ ok: true, created })
  } catch (err) {
    console.error('[cron/merge-proposals]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
