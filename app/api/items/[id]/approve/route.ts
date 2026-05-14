// POST /api/items/[id]/approve — human approves a ranked proposal.
//
// Body: { chosenProposalRank: 1..5 }
//
// Server reads Item.proposalCandidates[rank-1] and forks on kind:
//   - existing: Decision(action=approve, toFolderId=proposal.folderId), file there.
//   - new:      walk the path, create missing folders inside the transaction,
//               Decision(action=create_folder, folderCreatedId=leaf, toFolderId=leaf), file there.
//
// In both cases: pending_review → approved_pending_move.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError, HttpError } from '@/lib/http-error'
import { ensureFolderPath, isValidNewPath } from '@/lib/folder-path'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

const Body = z.object({
  chosenProposalRank: z.number().int().min(1).max(5),
})

const ProposalShape = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    folderId: z.string(),
    path: z.string(),
    confidence: z.number(),
  }),
  z.object({
    kind: z.literal('new'),
    path: z.string(),
    confidence: z.number(),
  }),
])

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireAuth(['user'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.item.findFirst({
        where: { id, userId: identity.userId },
        select: { status: true, proposalCandidates: true, proposedFolderId: true },
      })
      if (!item) throw new HttpError(404, 'Item not found')
      if (item.status !== 'pending_review') {
        throw new HttpError(409, `Item is ${item.status}, expected pending_review`)
      }

      const proposals = z.array(ProposalShape).parse(item.proposalCandidates ?? [])
      const idx = body.chosenProposalRank - 1
      if (idx < 0 || idx >= proposals.length) {
        throw new HttpError(400, `rank ${body.chosenProposalRank} out of range (have ${proposals.length})`)
      }
      const chosen = proposals[idx]

      if (chosen.kind === 'existing') {
        // Validate the folder still exists for this user (defense-in-depth;
        // it was already validated at classification time, but the folder
        // could have been deleted since).
        const folder = await tx.folder.findFirst({
          where: { id: chosen.folderId, userId: identity.userId },
          select: { id: true },
        })
        if (!folder) {
          throw new HttpError(409, `Proposed folder no longer exists: ${chosen.path}`)
        }
        await tx.decision.create({
          data: {
            itemId: id,
            userId: identity.userId,
            action: 'approve',
            toFolderId: chosen.folderId,
            fromFolderId: item.proposedFolderId,
            chosenProposalRank: body.chosenProposalRank,
          },
        })
        const updated = await tx.item.update({
          where: { id },
          data: {
            status: 'approved_pending_move',
            folderId: chosen.folderId,
          },
        })
        return { item: updated, kind: 'existing' as const, folderId: chosen.folderId }
      }

      // chosen.kind === 'new' — walk the path, create missing folders.
      if (!isValidNewPath(chosen.path)) {
        throw new HttpError(400, `invalid new-folder path: ${chosen.path}`)
      }
      const ensured = await ensureFolderPath(tx, identity.userId, chosen.path)
      await tx.decision.create({
        data: {
          itemId: id,
          userId: identity.userId,
          action: 'create_folder',
          folderCreatedId: ensured.leafFolderId,
          toFolderId: ensured.leafFolderId,
          chosenProposalRank: body.chosenProposalRank,
        },
      })
      const updated = await tx.item.update({
        where: { id },
        data: {
          status: 'approved_pending_move',
          folderId: ensured.leafFolderId,
        },
      })
      return {
        item: updated,
        kind: 'new' as const,
        folderId: ensured.leafFolderId,
        createdFolderIds: ensured.createdFolderIds,
      }
    })

    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    if ((e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Folder path collision during create' }, { status: 409 })
    }
    console.error('[POST /api/items/[id]/approve]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
