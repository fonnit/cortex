import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const userId = await requireAuth()

    // Latest MetricSnapshot
    const snapshot = await prisma.metricSnapshot.findFirst({
      where: { user_id: userId },
      orderBy: { captured_at: 'desc' },
    })

    // Count of filed items ingested in the past 7 days as citedAnswers proxy
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Live queue depths, rule counts, dormant ratio, and sparkline data
    const [relevanceCount, labelCount, rulesCount, allRules, recentSnapshots, citedAnswersProxy] = await Promise.all([
      // relevance queue: uncertain + no axis classification yet
      prisma.item.count({
        where: { user_id: userId, status: 'uncertain', axis_type: null },
      }),
      // label queue: uncertain + axis classification in progress
      prisma.item.count({
        where: { user_id: userId, status: 'uncertain', axis_type: { not: null } },
      }),
      // active rules count
      prisma.rule.count({
        where: { user_id: userId, status: 'active' },
      }),
      // all rules for dormant ratio + median rules-in-context
      prisma.rule.findMany({
        where: { user_id: userId },
        select: { status: true, prefilter_bucket: true, fires: true },
      }),
      // last 8 daily MetricSnapshots for queueTrend sparkline
      prisma.metricSnapshot.findMany({
        where: { user_id: userId },
        orderBy: { captured_at: 'desc' },
        take: 8,
        select: { total_uncertain: true },
      }),
      // citedAnswers proxy: filed items ingested in the past 7 days
      prisma.item.count({
        where: {
          user_id: userId,
          status: 'filed',
          ingested_at: { gte: oneWeekAgo },
        },
      }),
    ])

    // Compute dormant ratio
    const totalRules = allRules.length
    const dormantCount = allRules.filter(r => r.status === 'dormant').length
    const dormantRatio = totalRules > 0 ? dormantCount / totalRules : null

    // Compute median rules-in-context: group rules by prefilter_bucket, take median bucket size
    const bucketSizes = Object.values(
      allRules.reduce<Record<string, number>>((acc, r) => {
        acc[r.prefilter_bucket] = (acc[r.prefilter_bucket] ?? 0) + 1
        return acc
      }, {})
    ).sort((a, b) => a - b)
    const medianRulesInCtx = bucketSizes.length > 0
      ? bucketSizes[Math.floor(bucketSizes.length / 2)]
      : null

    // queueTrend: last 8 snapshots total_uncertain (reversed to oldest-first for sparkline)
    const queueTrend = recentSnapshots.map(s => s.total_uncertain).reverse()

    const data = {
      queues: {
        relevance: relevanceCount,
        label: labelCount,
      },
      weekly: {
        citedAnswers: citedAnswersProxy,
        medianDecisionSec: null,  // Phase 3 — requires TriageDecision table (not yet instrumented)
      },
      auto: {
        relevanceAutoPct: snapshot?.auto_filed_rate ?? null,
        labelAutoPct: snapshot?.auto_filed_rate ?? null,  // proxy until separate metric exists
        rules: rulesCount,
        medianRulesInCtx,
        dormantRatio,
      },
      queueTrend,
      weeklyPulse: null,  // Phase 4 / manual input
    }

    return Response.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[/api/metrics] Unexpected error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
