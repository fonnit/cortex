// POST /api/items/[id]/retry — Failed-tab Retry action.
// Resets a terminal-failed item back into the pipeline.
// classification_failed → pending_classification (attempts=0)
// move_failed → approved_pending_move (worker re-attempts mv)

import { NextResponse } from 'next/server'
import { transitionItem } from '@/lib/transition-item'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError, HttpError } from '@/lib/http-error'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireAuth(['user'])
    const { id } = await ctx.params

    const item = await prisma.item.findFirst({
      where: { id, userId: identity.userId },
      select: { status: true },
    })
    if (!item) throw new HttpError(404, 'Item not found')

    if (item.status === 'classification_failed') {
      const updated = await transitionItem({
        itemId: id,
        userId: identity.userId,
        allowedFrom: 'classification_failed',
        decision: { action: 'retry' },
        itemUpdate: { status: 'pending_classification', attempts: 0, leasedAt: null },
      })
      return NextResponse.json({ item: updated }, { status: 200 })
    }

    if (item.status === 'move_failed') {
      const updated = await transitionItem({
        itemId: id,
        userId: identity.userId,
        allowedFrom: 'move_failed',
        decision: { action: 'retry' },
        itemUpdate: { status: 'approved_pending_move', attempts: 0, leasedAt: null },
      })
      return NextResponse.json({ item: updated }, { status: 200 })
    }

    return NextResponse.json(
      { error: `Cannot retry from ${item.status}` },
      { status: 409 },
    )
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[POST /api/items/[id]/retry]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
