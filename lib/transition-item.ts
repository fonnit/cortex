// Shared mutation helper for the four human-triggered triage routes (approve,
// move, reject, create-folder) and the Failed-tab actions (retry, readd,
// delete_record). Centralizes the state-transition contract so each route is
// ~15 LOC.
//
// Runs inside a single $transaction:
//   1) SELECT Item by id (+ userId scope)
//   2) Verify status ∈ allowedFrom
//   3) Write Decision row
//   4) Update Item (status + optional folderId/finalPath/etc.)
//
// Concurrency: status check + update are inside the same transaction so a
// double-submit gets 409 not duplicate Decisions. Conway boundary: the API
// (this helper) IS the data boundary — workers and the UI go through this
// path, never around it.

import type { ItemStatus, DecisionAction, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { HttpError } from './http-error'

export type TransitionInput = {
  itemId: string
  userId: string
  allowedFrom: ItemStatus | ItemStatus[]

  decision: {
    action: DecisionAction
    fromFolderId?: string | null
    toFolderId?: string | null
    folderCreatedId?: string | null
    chosenProposalRank?: number | null
    rationale?: string | null
  }

  itemUpdate: Partial<{
    status: ItemStatus
    folderId: string | null
    finalPath: string | null
    leasedAt: Date | null
    attempts: number
    supersededByItemId: string | null
  }>
}

export async function transitionItem(input: TransitionInput) {
  const allowed = Array.isArray(input.allowedFrom) ? input.allowedFrom : [input.allowedFrom]

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const item = await tx.item.findFirst({
      where: { id: input.itemId, userId: input.userId },
      select: { status: true },
    })

    if (!item) throw new HttpError(404, 'Item not found')

    if (!allowed.includes(item.status)) {
      throw new HttpError(
        409,
        `Item is ${item.status}; expected one of: ${allowed.join(', ')}`,
      )
    }

    await tx.decision.create({
      data: {
        itemId: input.itemId,
        userId: input.userId,
        action: input.decision.action,
        fromFolderId: input.decision.fromFolderId ?? null,
        toFolderId: input.decision.toFolderId ?? null,
        folderCreatedId: input.decision.folderCreatedId ?? null,
        chosenProposalRank: input.decision.chosenProposalRank ?? null,
        rationale: input.decision.rationale ?? null,
      },
    })

    return tx.item.update({
      where: { id: input.itemId },
      data: input.itemUpdate,
    })
  })
}
