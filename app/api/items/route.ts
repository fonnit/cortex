// POST /api/items — worker-token endpoint (cortex add enqueues a file).
// Body: { sourcePath: string, sha256: string, mimeType?: string, sizeBytes: number }
// Response: 200 { item: { id, status } } | 409 if SHA256 dup for this user.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { HttpError, isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const Body = z.object({
  sourcePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().optional().nullable(),
  sizeBytes: z.number().int().nonnegative(),
})

export async function POST(req: Request) {
  try {
    const identity = await requireAuth(['machine'])
    const body = Body.parse(await req.json())

    try {
      const item = await prisma.item.create({
        data: {
          userId: identity.userId,
          sourcePath: body.sourcePath,
          sha256: body.sha256,
          mimeType: body.mimeType ?? null,
          sizeBytes: body.sizeBytes,
          status: 'pending_classification',
        },
        select: { id: true, status: true },
      })
      return NextResponse.json({ item }, { status: 200 })
    } catch (e) {
      // Prisma unique constraint code P2002
      if ((e as { code?: string }).code === 'P2002') {
        const existing = await prisma.item.findUnique({
          where: { userId_sha256: { userId: identity.userId, sha256: body.sha256 } },
          select: { id: true, status: true },
        })
        return NextResponse.json(
          { error: 'duplicate', item: existing },
          { status: 409 },
        )
      }
      throw e
    }
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items] error', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
