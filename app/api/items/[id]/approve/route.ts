// POST /api/items/[id]/approve — human approves the top (or ranked-N) proposal.
// Body: { folderId: string, chosenProposalRank: 1..5 }
// Status transition: pending_review → approved_pending_move.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { transitionItem } from '@/lib/transition-item'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const Body = z.object({
  folderId: z.string().min(1),
  chosenProposalRank: z.number().int().min(1).max(5),
})

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireAuth(['user'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    // Validate folder belongs to user
    const folder = await prisma.folder.findFirst({
      where: { id: body.folderId, userId: identity.userId },
      select: { id: true },
    })
    if (!folder) {
      return NextResponse.json({ error: 'folder not found' }, { status: 404 })
    }

    const item = await transitionItem({
      itemId: id,
      userId: identity.userId,
      allowedFrom: 'pending_review',
      decision: {
        action: 'approve',
        toFolderId: body.folderId,
        chosenProposalRank: body.chosenProposalRank,
      },
      itemUpdate: {
        status: 'approved_pending_move',
        folderId: body.folderId,
      },
    })

    return NextResponse.json({ item }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items/[id]/approve]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
