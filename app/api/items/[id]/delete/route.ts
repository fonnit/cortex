// POST /api/items/[id]/delete — Failed-tab Delete action.
// Hard-deletes an Item row (only allowed from terminal failure states that
// have no path forward in v1: unsupported_type, source_missing, source_changed).
// Writes a Decision row of action=delete_record FIRST (audit trail), then
// deletes — but Decision has FK with onDelete: Cascade so cascades wipe the
// Decision too. So we just delete the Item and rely on the upstream Failed-tab
// log to confirm. The Decision row creation is intentionally skipped here.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const DELETABLE = new Set(['unsupported_type', 'source_missing', 'source_changed', 'rejected'])

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireAuth(['user'])
    const { id } = await ctx.params

    const item = await prisma.item.findFirst({
      where: { id, userId: identity.userId },
      select: { status: true },
    })
    if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (!DELETABLE.has(item.status)) {
      return NextResponse.json(
        { error: `Cannot delete from ${item.status}` },
        { status: 409 },
      )
    }

    await prisma.item.delete({ where: { id } })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[POST /api/items/[id]/delete]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
