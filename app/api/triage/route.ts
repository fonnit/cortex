import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

// Derive stage from classification_trace
function deriveStage(classificationTrace: unknown): 'label' | 'relevance' {
  if (!classificationTrace || typeof classificationTrace !== 'object') return 'relevance'
  const trace = classificationTrace as Record<string, unknown>
  const stage2 = trace.stage2 as Record<string, unknown> | undefined
  if (stage2 && stage2.proposals && typeof stage2.proposals === 'object') {
    const proposals = stage2.proposals as Record<string, unknown>
    if (Object.keys(proposals).length > 0) return 'label'
  }
  return 'relevance'
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

    const mapped = items.map((item) => ({
      ...item,
      stage: deriveStage(item.classification_trace),
    }))

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

  // skip: no DB write
  if (type === 'skip') {
    return Response.json({ ok: true, status: 'uncertain' })
  }

  try {
    if (type === 'keep') {
      await prisma.item.update({
        where: { id: itemId, user_id: userId },
        data: { status: 'certain' },
      })
      return Response.json({ ok: true, status: 'certain' })
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
