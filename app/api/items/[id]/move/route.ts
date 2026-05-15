// POST /api/items/[id]/move — human picks a different existing folder.
// Body: { folderId }

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { transitionItem } from '@/lib/transition-item'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'
import { prisma } from '@/lib/prisma'
import { FinalFilenameSchema } from '@/lib/final-filename'

export const runtime = 'nodejs'

const Body = z.object({
  folderId: z.string().min(1),
  finalFilename: FinalFilenameSchema,
})

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['user'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    const folder = await prisma.folder.findUnique({
      where: { id: body.folderId },
      select: { id: true },
    })
    if (!folder) return NextResponse.json({ error: 'folder not found' }, { status: 404 })

    const current = await prisma.item.findUnique({
      where: { id },
      select: { proposedFolderId: true },
    })

    const item = await transitionItem({
      itemId: id,
      allowedFrom: 'pending_review',
      decision: {
        action: 'move',
        fromFolderId: current?.proposedFolderId ?? null,
        toFolderId: body.folderId,
      },
      itemUpdate: {
        status: 'approved_pending_move',
        folderId: body.folderId,
        finalFilename: body.finalFilename,
      },
    })

    return NextResponse.json({ item }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items/[id]/move]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
