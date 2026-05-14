// POST /api/items/claim — worker single-flight claim + opportunistic sweep.
//
// Body: { stage: 'classification' | 'move' }
// Response: 200 { item: Item } when a row was claimed | 204 no content otherwise.
//
// Lease semantics: SELECT FOR UPDATE SKIP LOCKED inside an UPDATE..RETURNING
// (single SQL statement). leasedAt is set on the claimed row; attempts is
// incremented. Sweep runs BEFORE the claim in the same request, resetting any
// leasedAt older than 5 min. After 3 attempts, the sweep terminates the Item
// (classification_failed or move_failed). No separate cron needed — the worker's
// own polling drives recovery. See plan finding 4C.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { HttpError, isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const Body = z.object({ stage: z.enum(['classification', 'move']) })

const PENDING: Record<'classification' | 'move', 'pending_classification' | 'approved_pending_move'> = {
  classification: 'pending_classification',
  move: 'approved_pending_move',
}

const FAILURE: Record<'classification' | 'move', 'classification_failed' | 'move_failed'> = {
  classification: 'classification_failed',
  move: 'move_failed',
}

export async function POST(req: Request) {
  try {
    const identity = await requireAuth(['machine'])
    const { stage } = Body.parse(await req.json())

    const pending = PENDING[stage]
    const failure = FAILURE[stage]

    // Sweep + claim in two raw statements. The sweep is intentionally separate
    // from the claim (different WHERE shape) and runs first.
    await prisma.$executeRaw`
      UPDATE "Item"
      SET "leasedAt" = NULL
      WHERE "userId" = ${identity.userId}
        AND status = ${pending}::"ItemStatus"
        AND "leasedAt" IS NOT NULL
        AND "leasedAt" < NOW() - INTERVAL '5 minutes'
        AND "attempts" < 3
    `

    await prisma.$executeRaw`
      UPDATE "Item"
      SET status = ${failure}::"ItemStatus"
      WHERE "userId" = ${identity.userId}
        AND status = ${pending}::"ItemStatus"
        AND "leasedAt" IS NOT NULL
        AND "leasedAt" < NOW() - INTERVAL '5 minutes'
        AND "attempts" >= 3
    `

    // Atomic claim: single statement with SELECT FOR UPDATE SKIP LOCKED.
    // Returns the claimed row or empty.
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "Item"
      SET "leasedAt" = NOW(), "attempts" = "attempts" + 1
      WHERE id = (
        SELECT id FROM "Item"
        WHERE "userId" = ${identity.userId}
          AND status = ${pending}::"ItemStatus"
          AND "attempts" < 3
          AND ("leasedAt" IS NULL OR "leasedAt" < NOW() - INTERVAL '5 minutes')
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id
    `

    if (rows.length === 0) {
      return new NextResponse(null, { status: 204 })
    }

    const item = await prisma.item.findUnique({
      where: { id: rows[0].id },
    })
    return NextResponse.json({ item }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items/claim] error', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
