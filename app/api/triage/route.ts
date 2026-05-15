// GET /api/triage — pending_review queue + Failed-tab + folder index for UI.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const FAILED_STATUSES = [
  'classification_failed',
  'move_failed',
  'source_missing',
  'source_changed',
  'unsupported_type',
] as const

export async function GET() {
  try {
    await requireAuth(['user'])

    const [pending, failed, allFolders] = await Promise.all([
      prisma.item.findMany({
        where: { status: 'pending_review' },
        orderBy: { capturedAt: 'asc' },
        select: {
          id: true,
          sourcePath: true,
          mimeType: true,
          sizeBytes: true,
          capturedAt: true,
          proposalCandidates: true,
          proposedFolderId: true,
          confidence: true,
          extractionKind: true,
          suggestedFilename: true,
        },
      }),
      prisma.item.findMany({
        where: { status: { in: [...FAILED_STATUSES] } },
        orderBy: { capturedAt: 'desc' },
        select: {
          id: true,
          sourcePath: true,
          mimeType: true,
          status: true,
          extractionKind: true,
          attempts: true,
          capturedAt: true,
        },
      }),
      prisma.folder.findMany({
        orderBy: { path: 'asc' },
        select: { id: true, name: true, path: true, parentId: true, isSeed: true },
      }),
    ])

    const folderById = Object.fromEntries(allFolders.map((f) => [f.id, f]))
    return NextResponse.json({ pending, failed, folders: allFolders, folderById })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[GET /api/triage]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
