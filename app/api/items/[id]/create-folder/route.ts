// POST /api/items/[id]/create-folder — human types a new folder; creates + files.
// Body: { name, parentId? }

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError, HttpError } from '@/lib/http-error'
import { computeFolderPath } from '@/lib/taxonomy'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

const FolderName = z
  .string()
  .trim()
  .min(1, 'Folder name required')
  .max(60, 'Max 60 characters')
  .regex(/^[\w\s-]+$/u, 'Letters, digits, space, dash, underscore only')
  .transform((s) => s.replace(/\s+/g, ' '))
  .refine((s) => !['.', '..', '_rejected'].includes(s), 'Reserved name')

const Body = z.object({ name: FolderName, parentId: z.string().nullable().optional() })

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['user'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    const parentId = body.parentId ?? null
    const path = await computeFolderPath(parentId, body.name)

    const dup = await prisma.folder.findFirst({
      where: { parentId, name: { equals: body.name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (dup) {
      return NextResponse.json({ error: 'Folder already exists at this level' }, { status: 409 })
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.item.findUnique({ where: { id }, select: { status: true } })
      if (!item) throw new HttpError(404, 'Item not found')
      if (item.status !== 'pending_review') {
        throw new HttpError(409, `Item is ${item.status}; expected pending_review`)
      }

      const folder = await tx.folder.create({
        data: { parentId, name: body.name, path, isSeed: false },
      })

      await tx.decision.create({
        data: {
          itemId: id,
          action: 'create_folder',
          folderCreatedId: folder.id,
          toFolderId: folder.id,
        },
      })

      const updatedItem = await tx.item.update({
        where: { id },
        data: { status: 'approved_pending_move', folderId: folder.id },
      })

      return { folder, item: updatedItem }
    })

    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    if ((e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Folder path already exists' }, { status: 409 })
    }
    console.error('[POST /api/items/[id]/create-folder]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
