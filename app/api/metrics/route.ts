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

    // Live queue depths from Item table
    const [relevanceCount, labelCount, rulesCount] = await Promise.all([
      // relevance queue: uncertain + no axis classification yet
      prisma.item.count({
        where: { user_id: userId, status: 'uncertain', axis_type: null },
      }),
      // label queue: uncertain + axis classification in progress
      prisma.item.count({
        where: { user_id: userId, status: 'uncertain', axis_type: { not: null } },
      }),
      // active rules count
      prisma.taxonomyLabel.count({
        where: { user_id: userId, deprecated: false },
      }),
    ])

    const data = {
      queues: {
        relevance: relevanceCount,
        label: labelCount,
      },
      weekly: {
        citedAnswers: null,       // Phase 4
        medianDecisionSec: null,  // Phase 3
      },
      auto: {
        relevanceAutoPct: snapshot?.auto_filed_rate ?? null,
        labelAutoPct: null,       // Phase 3
        rules: rulesCount,
        dormantRatio: null,       // Phase 3
      },
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
