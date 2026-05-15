// POST /api/items/[id]/create-folder — human types a new folder; creates + files.
// Body: { name, parentId?, finalFilename }
//
// `name` may be a single segment ("branding") OR a path with slashes
// ("fonnit/branding"). Any missing intermediate folders are created via
// ensureFolderPath. parentId, when supplied, anchors the path under that
// existing folder; otherwise the path is treated as starting from the root.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError, HttpError } from '@/lib/http-error'
import { ensureFolderPath, isValidNewPath } from '@/lib/folder-path'
import { FinalFilenameSchema } from '@/lib/final-filename'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

// `name` is a path-fragment: 1+ segments separated by single slashes. Each
// segment matches /^[\w\s-]+$/. Leading/trailing slashes are tolerated and
// stripped. Empty segments rejected.
const PathFragment = z
  .string()
  .trim()
  .min(1, 'Folder name required')
  .max(200, 'Path too long')
  .transform((s) => s.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/'))
  .refine((s) => s.length > 0, 'Folder name required after trimming slashes')
  .refine(
    (s) => s.split('/').every((seg) => /^[\w\s-]+$/u.test(seg) && seg.length >= 1 && seg.length <= 60),
    'Each segment: letters / digits / space / - / _ only, max 60 chars',
  )

const Body = z.object({
  name: PathFragment,
  parentId: z.string().nullable().optional(),
  finalFilename: FinalFilenameSchema,
})

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['user'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    const parentId = body.parentId ?? null

    // Resolve the absolute target path. If parentId is given, anchor `name`
    // beneath the parent's path; otherwise treat `name` as starting at root.
    let absolutePath: string
    if (parentId) {
      const parent = await prisma.folder.findUnique({
        where: { id: parentId },
        select: { path: true },
      })
      if (!parent) throw new HttpError(404, 'Parent folder not found')
      absolutePath = parent.path.replace(/\/$/, '') + '/' + body.name
    } else {
      absolutePath = '/' + body.name
    }

    if (!isValidNewPath(absolutePath)) {
      return NextResponse.json({ error: `invalid folder path: ${absolutePath}` }, { status: 400 })
    }

    // If the absolute path already exists, surface a friendly conflict.
    const existing = await prisma.folder.findUnique({
      where: { path: absolutePath },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: 'Folder already exists at this path' }, { status: 409 })
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.item.findUnique({ where: { id }, select: { status: true } })
      if (!item) throw new HttpError(404, 'Item not found')
      if (item.status !== 'pending_review') {
        throw new HttpError(409, `Item is ${item.status}; expected pending_review`)
      }

      // Creates any missing ancestors plus the leaf folder. Idempotent on
      // ancestors (existing ones are reused).
      const ensured = await ensureFolderPath(tx, absolutePath)

      const leaf = await tx.folder.findUnique({
        where: { id: ensured.leafFolderId },
        select: { id: true, name: true, path: true, parentId: true },
      })

      await tx.decision.create({
        data: {
          itemId: id,
          action: 'create_folder',
          folderCreatedId: ensured.leafFolderId,
          toFolderId: ensured.leafFolderId,
        },
      })

      const updatedItem = await tx.item.update({
        where: { id },
        data: {
          status: 'approved_pending_move',
          folderId: ensured.leafFolderId,
          finalFilename: body.finalFilename,
        },
      })

      return { folder: leaf, item: updatedItem, createdFolderIds: ensured.createdFolderIds }
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
