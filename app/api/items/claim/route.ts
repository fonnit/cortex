// POST /api/items/claim — worker single-flight claim + opportunistic sweep.
// Body: { stage: 'classification' | 'move' }
// 200 { item } on claim, 204 if nothing pending.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

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
    await requireAuth(['machine'])
    const { stage } = Body.parse(await req.json())

    const pending = PENDING[stage]
    const failure = FAILURE[stage]

    // Sweep stale leases (older than 5 min, attempts < 3)
    await prisma.$executeRaw`
      UPDATE "Item"
      SET "leasedAt" = NULL
      WHERE status = ${pending}::"ItemStatus"
        AND "leasedAt" IS NOT NULL
        AND "leasedAt" < NOW() - INTERVAL '5 minutes'
        AND "attempts" < 3
    `

    // Transition exhausted items to failure
    await prisma.$executeRaw`
      UPDATE "Item"
      SET status = ${failure}::"ItemStatus"
      WHERE status = ${pending}::"ItemStatus"
        AND "leasedAt" IS NOT NULL
        AND "leasedAt" < NOW() - INTERVAL '5 minutes'
        AND "attempts" >= 3
    `

    // Atomic claim
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "Item"
      SET "leasedAt" = NOW(), "attempts" = "attempts" + 1
      WHERE id = (
        SELECT id FROM "Item"
        WHERE status = ${pending}::"ItemStatus"
          AND "attempts" < 3
          AND ("leasedAt" IS NULL OR "leasedAt" < NOW() - INTERVAL '5 minutes')
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id
    `

    if (rows.length === 0) return new NextResponse(null, { status: 204 })

    const item = await prisma.item.findUnique({ where: { id: rows[0].id } })
    return NextResponse.json({ item }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items/claim]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
