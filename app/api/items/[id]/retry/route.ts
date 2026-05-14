// POST /api/items/[id]/retry — Failed-tab Retry action.

import { NextResponse } from 'next/server'
import { transitionItem } from '@/lib/transition-item'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError, HttpError } from '@/lib/http-error'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['user'])
    const { id } = await ctx.params

    const item = await prisma.item.findUnique({ where: { id }, select: { status: true } })
    if (!item) throw new HttpError(404, 'Item not found')

    if (item.status === 'classification_failed') {
      const updated = await transitionItem({
        itemId: id,
        allowedFrom: 'classification_failed',
        decision: { action: 'retry' },
        itemUpdate: { status: 'pending_classification', attempts: 0, leasedAt: null },
      })
      return NextResponse.json({ item: updated }, { status: 200 })
    }

    if (item.status === 'move_failed') {
      const updated = await transitionItem({
        itemId: id,
        allowedFrom: 'move_failed',
        decision: { action: 'retry' },
        itemUpdate: { status: 'approved_pending_move', attempts: 0, leasedAt: null },
      })
      return NextResponse.json({ item: updated }, { status: 200 })
    }

    return NextResponse.json({ error: `Cannot retry from ${item.status}` }, { status: 409 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[POST /api/items/[id]/retry]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
