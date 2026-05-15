// POST /api/items/[id]/classification — worker posts classification result.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const FolderNameSegment = /^[\w\s-]+$/u

const ExistingProposal = z.object({
  kind: z.literal('existing'),
  folderId: z.string(),
  path: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

const NewProposal = z.object({
  kind: z.literal('new'),
  path: z.string().min(1).refine((p) => isValidNewPath(p), {
    message: 'invalid path — each segment must match /^[\\w\\s-]+$/ and be ≤ 60 chars',
  }),
  confidence: z.number().min(0).max(1),
})

const Proposal = z.discriminatedUnion('kind', [ExistingProposal, NewProposal])

const SuggestedFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .transform((s) => s.replace(/\.[^.]+$/, ''))  // strip any extension Haiku slipped in
  .refine((s) => /^[A-Za-z0-9 _-]+$/.test(s) && s.length >= 1, {
    message: 'filename must match /^[A-Za-z0-9 _-]+$/ after extension stripping',
  })

const ExtractionKindEnum = z.enum([
  'plain_text',
  'docx',
  'pdf_text',
  'ocr_image',
  'ocr_pdf',
  // legacy values, accepted for backward-compat with any v1-format POSTs in flight
  'text',
  'image',
  'pdf_native',
])

const Body = z.object({
  proposalCandidates: z.array(Proposal).min(1).max(5),
  suggestedFilename: SuggestedFilenameSchema,
  extractionKind: ExtractionKindEnum,
  extractionMs: z.number().int().nonnegative(),
  extractedCharCount: z.number().int().nonnegative().nullable(),
  extractedText: z.string().nullable().optional(),
})

function isValidNewPath(p: string): boolean {
  if (!p.startsWith('/')) return false
  const segs = p.slice(1).split('/')
  if (segs.some((s) => s.length === 0)) return false
  return segs.every((s) => FolderNameSegment.test(s) && s.length <= 60)
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['machine'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    const existingIds = body.proposalCandidates
      .filter((p): p is z.infer<typeof ExistingProposal> => p.kind === 'existing')
      .map((p) => p.folderId)

    if (existingIds.length > 0) {
      const folders = await prisma.folder.findMany({
        where: { id: { in: existingIds } },
        select: { id: true },
      })
      const known = new Set(folders.map((f) => f.id))
      const bad = existingIds.filter((id) => !known.has(id))
      if (bad.length > 0) {
        return NextResponse.json({ error: 'unknown folderIds', folderIds: bad }, { status: 400 })
      }
    }

    const newPaths = body.proposalCandidates
      .filter((p): p is z.infer<typeof NewProposal> => p.kind === 'new')
      .map((p) => p.path)
    if (newPaths.length > 0) {
      const existingAtPath = await prisma.folder.findMany({
        where: { path: { in: newPaths } },
        select: { path: true },
      })
      if (existingAtPath.length > 0) {
        return NextResponse.json(
          { error: 'new-kind proposals collide with existing folders', paths: existingAtPath.map((f) => f.path) },
          { status: 400 },
        )
      }
    }

    const top = body.proposalCandidates[0]
    const topProposedFolderId = top.kind === 'existing' ? top.folderId : null

    const updated = await prisma.item.updateMany({
      where: { id, status: 'pending_classification' },
      data: {
        status: 'pending_review',
        proposalCandidates: body.proposalCandidates,
        proposedFolderId: topProposedFolderId,
        confidence: top.confidence,
        classifiedAt: new Date(),
        extractionKind: body.extractionKind,
        extractionMs: body.extractionMs,
        extractedCharCount: body.extractedCharCount,
        extractedText: body.extractedText ?? null,
        suggestedFilename: body.suggestedFilename,
        leasedAt: null,
      },
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
    console.error('[POST /api/items/[id]/classification]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
