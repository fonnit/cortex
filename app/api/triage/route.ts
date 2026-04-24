import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

function deriveStage(item: { classification_trace: unknown; axis_type: string | null }): 'label' | 'relevance' {
  if (!item.classification_trace || typeof item.classification_trace !== 'object') return 'relevance'
  const trace = item.classification_trace as Record<string, unknown>
  const stage1 = trace.stage1 as Record<string, unknown> | undefined

  // If relevance decision is 'uncertain', user hasn't decided yet → relevance mode
  if (stage1?.decision === 'uncertain') return 'relevance'

  // If relevance is 'keep' (decided by classifier or user), check if we have label data
  const stage2 = trace.stage2 as Record<string, unknown> | undefined
  if (stage2?.axes) return 'label'

  // Keep decision but no label data yet → needs label classification
  // This shouldn't happen in normal flow but treat as relevance fallback
  return 'relevance'
}

function buildProposals(item: {
  classification_trace: unknown
  axis_type: string | null
  axis_from: string | null
  axis_context: string | null
  axis_type_confidence: number | null
  axis_from_confidence: number | null
  axis_context_confidence: number | null
}) {
  const trace = item.classification_trace as Record<string, unknown> | null
  const stage2 = trace?.stage2 as Record<string, unknown> | undefined
  const axes = stage2?.axes as Record<string, { value: string | null; confidence: number }> | undefined
  if (!axes) return null

  const CONFIDENCE_THRESHOLD = 0.75
  const confident: string[] = []

  const proposals: Record<string, Array<{ value: string; conf: number }>> = {}
  for (const [axis, data] of Object.entries(axes)) {
    if (data.confidence >= CONFIDENCE_THRESHOLD) confident.push(axis)
    if (data.value) {
      proposals[axis] = [{ value: data.value, conf: data.confidence }]
    }
  }

  return { proposals, confident }
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  try {
    const items = await prisma.item.findMany({
      where: { user_id: userId, status: 'uncertain' },
      orderBy: { ingested_at: 'asc' },
      take: 50,
    })

    const mapped = items.map((item) => {
      const stage = deriveStage(item)
      const labelData = stage === 'label' ? buildProposals(item) : null

      // Rewrite classification_trace to match ExpandedCard's expected shape
      const trace = (item.classification_trace as Record<string, unknown>) ?? {}
      const normalizedTrace = { ...trace }
      if (labelData) {
        normalizedTrace.stage2 = {
          ...(trace.stage2 as Record<string, unknown> ?? {}),
          proposals: labelData.proposals,
          confident: labelData.confident,
        }
      }

      return {
        ...item,
        classification_trace: normalizedTrace,
        stage,
      }
    })

    return Response.json(mapped)
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }
}

const DecisionSchema = z.object({
  itemId: z.string(),
  type: z.enum(['keep', 'ignore', 'archive', 'confirm', 'skip']),
  picks: z
    .object({
      Type: z.string().optional(),
      From: z.string().optional(),
      Context: z.string().optional(),
    })
    .optional(),
})

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = DecisionSchema.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  const { itemId, type, picks } = parsed.data

  if (type === 'skip') {
    return Response.json({ ok: true, status: 'uncertain' })
  }

  try {
    if (type === 'keep') {
      // Relevance keep: update trace to mark relevance as resolved, keep status uncertain for label triage
      const item = await prisma.item.findUnique({ where: { id: itemId, user_id: userId } })
      if (!item) return new Response('Not Found', { status: 404 })

      const trace = (item.classification_trace as Record<string, unknown>) ?? {}
      const stage1 = (trace.stage1 as Record<string, unknown>) ?? {}

      // If item already has stage2 data, it stays uncertain for label triage
      // If item doesn't have stage2, mark relevance as keep so it shows as needing label classification
      const updatedTrace = {
        ...trace,
        stage1: { ...stage1, decision: 'keep', human_override: true },
      }

      // If no stage2 exists yet, we need to run label classification
      if (!trace.stage2) {
        // For now, just mark the relevance decision; the item stays in the queue
        // A background job or the next scan will pick it up for Stage 2
        // For immediate feedback, set a flag so the UI can show "awaiting classification"
        await prisma.item.update({
          where: { id: itemId, user_id: userId },
          data: {
            classification_trace: updatedTrace,
            status: 'uncertain',
          },
        })
        return Response.json({ ok: true, status: 'uncertain', needsClassification: true })
      }

      // Has stage2 already — just update the relevance decision
      await prisma.item.update({
        where: { id: itemId, user_id: userId },
        data: { classification_trace: updatedTrace },
      })
      return Response.json({ ok: true, status: 'uncertain' })
    }

    if (type === 'ignore') {
      await prisma.item.update({
        where: { id: itemId, user_id: userId },
        data: { status: 'ignored' },
      })
      return Response.json({ ok: true, status: 'ignored' })
    }

    if (type === 'archive' || type === 'confirm') {
      const data: Record<string, unknown> = { status: 'certain' }
      if (picks?.Type) data.axis_type = picks.Type
      if (picks?.From) data.axis_from = picks.From
      if (picks?.Context) data.axis_context = picks.Context
      await prisma.item.update({
        where: { id: itemId, user_id: userId },
        data,
      })
      return Response.json({ ok: true, status: 'certain' })
    }

    return new Response('Bad Request', { status: 400 })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }
}
