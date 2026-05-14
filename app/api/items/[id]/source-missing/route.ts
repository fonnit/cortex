// POST /api/items/[id]/source-missing — worker reports source gone at classify time.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['machine'])
    const { id } = await ctx.params
    const updated = await prisma.item.updateMany({
      where: { id, status: 'pending_classification' },
      data: { status: 'source_missing', leasedAt: null },
    })
    if (updated.count === 0) return NextResponse.json({ error: 'not found or wrong status' }, { status: 409 })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[POST /api/items/[id]/source-missing]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
