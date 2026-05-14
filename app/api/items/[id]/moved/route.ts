// POST /api/items/[id]/moved — worker reports file moved.
// Body: { finalPath }

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const Body = z.object({ finalPath: z.string().min(1) })

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['machine'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    const updated = await prisma.item.updateMany({
      where: { id, status: 'approved_pending_move' },
      data: { status: 'filed', finalPath: body.finalPath, leasedAt: null },
    })

    if (updated.count === 0) {
      const exists = await prisma.item.findUnique({ where: { id }, select: { status: true } })
      if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 })
      return NextResponse.json({ error: 'wrong status', status: exists.status }, { status: 409 })
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items/[id]/moved]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
