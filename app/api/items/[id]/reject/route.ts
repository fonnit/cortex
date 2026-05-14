// POST /api/items/[id]/reject — human rejects the item.
// No body. Status: pending_review or approved_pending_move → rejected (the
// approved_pending_move case cancels an in-flight worker move-claim, which is
// safe because the worker re-hashes at move time and would no-op if the file
// is gone).
// Source file is left at its original sourcePath; v1 does not delete on reject.

import { NextResponse } from 'next/server'
import { transitionItem } from '@/lib/transition-item'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireAuth(['user'])
    const { id } = await ctx.params

    const item = await transitionItem({
      itemId: id,
      userId: identity.userId,
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
