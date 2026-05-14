// POST /api/items/[id]/reject — human rejects the item.

import { NextResponse } from 'next/server'
import { transitionItem } from '@/lib/transition-item'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['user'])
    const { id } = await ctx.params

    const item = await transitionItem({
      itemId: id,
      allowedFrom: ['pending_review', 'approved_pending_move'],
      decision: { action: 'reject' },
      itemUpdate: { status: 'rejected', leasedAt: null },
    })

    return NextResponse.json({ item }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[POST /api/items/[id]/reject]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
