// POST /api/items/[id]/delete — Failed-tab Delete action.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const DELETABLE = new Set(['unsupported_type', 'source_missing', 'source_changed', 'rejected'])

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['user'])
    const { id } = await ctx.params

    const item = await prisma.item.findUnique({ where: { id }, select: { status: true } })
    if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (!DELETABLE.has(item.status)) {
      return NextResponse.json({ error: `Cannot delete from ${item.status}` }, { status: 409 })
    }

    await prisma.item.delete({ where: { id } })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[POST /api/items/[id]/delete]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
