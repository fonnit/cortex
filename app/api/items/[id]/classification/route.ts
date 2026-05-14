// POST /api/items/[id]/classification — worker posts classification result.
//
// Body: {
//   proposalCandidates: Array<{folderId, confidence}> length 1-5 desc,
//   proposedNewFolder?: string | null,
//   extractionKind: 'text' | 'image' | 'pdf_native',
//   extractionMs: number,
//   extractedCharCount: number | null,
// }
//
// Status transition: pending_classification → pending_review.
// If the item moved out of pending_classification while we were classifying
// (e.g. user retried), return 409 — the worker discards this result.
// If extraction returned unsupported, the worker calls /unsupported instead.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { HttpError, isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const Body = z.object({
  proposalCandidates: z
    .array(z.object({ folderId: z.string(), confidence: z.number().min(0).max(1) }))
    .min(1)
    .max(5),
  proposedNewFolder: z.string().nullable().optional(),
  extractionKind: z.enum(['text', 'image', 'pdf_native']),
  extractionMs: z.number().int().nonnegative(),
  extractedCharCount: z.number().int().nonnegative().nullable(),
})

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireAuth(['machine'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    // Validate proposal folderIds exist for this user
    const folderIds = body.proposalCandidates.map((p) => p.folderId)
    const folders = await prisma.folder.findMany({
      where: { id: { in: folderIds }, userId: identity.userId },
      select: { id: true },
    })
    const known = new Set(folders.map((f) => f.id))
    const bad = folderIds.filter((id) => !known.has(id))
    if (bad.length > 0) {
      return NextResponse.json(
        { error: 'unknown folderIds', folderIds: bad },
        { status: 400 },
      )
    }

    const updated = await prisma.item.updateMany({
      where: {
        id,
        userId: identity.userId,
        status: 'pending_classification',
      },
      data: {
        status: 'pending_review',
        proposalCandidates: body.proposalCandidates,
        proposedFolderId: body.proposalCandidates[0].folderId,
        proposedNewFolder: body.proposedNewFolder ?? null,
        confidence: body.proposalCandidates[0].confidence,
        classifiedAt: new Date(),
        extractionKind: body.extractionKind,
        extractionMs: body.extractionMs,
        extractedCharCount: body.extractedCharCount,
        leasedAt: null,
      },
    })

    if (updated.count === 0) {
      // Either the item doesn't exist for this user or it was already moved
      const exists = await prisma.item.findFirst({
        where: { id, userId: identity.userId },
        select: { status: true },
      })
      if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 })
      return NextResponse.json(
        { error: 'wrong status', status: exists.status },
        { status: 409 },
      )
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items/[id]/classification] error', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
