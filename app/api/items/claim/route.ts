// POST /api/items/claim — worker single-flight claim + opportunistic sweep.
// Body: { stage: 'classification' | 'move' | 'embed' }
// 200 { item } on claim, 204 if nothing pending.
//
// embed is structurally separate from classification/move: it uses its own
// lease columns (chunkLeasedAt / chunkAttempts), its exhaustion does NOT
// transition Item.status (only writes chunkError), and the response includes
// Item.extractedText so the worker can chunk + embed without a round trip.
// For non-embed stages we strip extractedText from the response payload —
// OCR'd contracts can be 50-100kb and the worker doesn't need them.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Item } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const Body = z.object({ stage: z.enum(['classification', 'move', 'embed']) })

const PENDING: Record<'classification' | 'move', 'pending_classification' | 'approved_pending_move'> = {
  classification: 'pending_classification',
  move: 'approved_pending_move',
}

const FAILURE: Record<'classification' | 'move', 'classification_failed' | 'move_failed'> = {
  classification: 'classification_failed',
  move: 'move_failed',
}

async function claimClassifyOrMove(stage: 'classification' | 'move') {
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
  return rows[0]?.id ?? null
}

async function claimEmbed(): Promise<string | null> {
  // Sweep stale embed leases — return them to the pool if retries remain.
  await prisma.$executeRaw`
    UPDATE "Item"
    SET "chunkLeasedAt" = NULL
    WHERE "chunkLeasedAt" IS NOT NULL
      AND "chunkLeasedAt" < NOW() - INTERVAL '5 minutes'
      AND "chunkAttempts" < 3
      AND "chunkedAt" IS NULL
  `

  // Exhausted embed attempts — write chunkError but do NOT touch Item.status,
  // because classify + move are decoupled from embed.
  await prisma.$executeRaw`
    UPDATE "Item"
    SET "chunkError" = 'attempts_exhausted',
        "chunkLeasedAt" = NULL
    WHERE "chunkLeasedAt" IS NOT NULL
      AND "chunkLeasedAt" < NOW() - INTERVAL '5 minutes'
      AND "chunkAttempts" >= 3
      AND "chunkedAt" IS NULL
  `

  // Atomic claim. Eligibility:
  //   - extractedText is present (classify has run and wrote it)
  //   - chunkedAt IS NULL (not yet chunked)
  //   - chunkAttempts < 3
  //   - status is past classification (avoids racing with classify-retry loops)
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Item"
    SET "chunkLeasedAt" = NOW(), "chunkAttempts" = "chunkAttempts" + 1
    WHERE id = (
      SELECT id FROM "Item"
      WHERE "chunkedAt" IS NULL
        AND "extractedText" IS NOT NULL
        AND "chunkAttempts" < 3
        AND ("chunkLeasedAt" IS NULL OR "chunkLeasedAt" < NOW() - INTERVAL '5 minutes')
        AND status IN ('pending_review', 'approved_pending_move', 'filed')
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `
  return rows[0]?.id ?? null
}

// Drop extractedText for non-embed stages — it's only useful to the embed
// loop, and OCR'd contracts can balloon the response payload.
function stripExtractedText<T extends Pick<Item, 'extractedText'>>(item: T): Omit<T, 'extractedText'> & { extractedText?: undefined } {
  const { extractedText: _omit, ...rest } = item
  void _omit
  return rest as Omit<T, 'extractedText'> & { extractedText?: undefined }
}

export async function POST(req: Request) {
  try {
    await requireAuth(['machine'])
    const { stage } = Body.parse(await req.json())

    const id = stage === 'embed'
      ? await claimEmbed()
      : await claimClassifyOrMove(stage)

    if (!id) return new NextResponse(null, { status: 204 })

    const item = await prisma.item.findUnique({ where: { id } })
    if (!item) return new NextResponse(null, { status: 204 })

    const payload = stage === 'embed' ? item : stripExtractedText(item)
    return NextResponse.json({ item: payload }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items/claim]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
