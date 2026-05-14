// POST /api/items/[id]/move-failed — worker reports the mv failed.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const Body = z.object({
  reason: z.string().min(1).max(500),
  kind: z.enum(['move_failed', 'source_changed', 'source_missing']),
})

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['machine'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    const updated = await prisma.item.updateMany({
      where: { id, status: 'approved_pending_move' },
      data: { status: body.kind, leasedAt: null },
    })

    if (updated.count === 0) {
      return NextResponse.json({ error: 'not found or wrong status' }, { status: 409 })
    }
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items/[id]/move-failed]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
