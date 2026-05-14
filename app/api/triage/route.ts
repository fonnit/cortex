// GET /api/triage — list items for the triage UI.
//
// Returns:
//   pending: pending_review items (oldest first)
//   failed: all terminal-failure items (Failed tab)
//
// Each Item is joined with its proposalCandidates' folder rows so the UI can
// render names without a second round trip.

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
    const identity = await requireAuth(['user'])

    const [pending, failed, allFolders] = await Promise.all([
      prisma.item.findMany({
        where: { userId: identity.userId, status: 'pending_review' },
        orderBy: { capturedAt: 'asc' },
        select: {
          id: true,
          sourcePath: true,
          mimeType: true,
          sizeBytes: true,
          capturedAt: true,
          proposalCandidates: true,
          proposedFolderId: true,
          proposedNewFolder: true,
          confidence: true,
          extractionKind: true,
        },
      }),
      prisma.item.findMany({
        where: { userId: identity.userId, status: { in: [...FAILED_STATUSES] } },
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
        where: { userId: identity.userId },
        orderBy: { path: 'asc' },
        select: { id: true, name: true, path: true, parentId: true, isSeed: true },
      }),
    ])

    // Build a folder lookup map for the UI to resolve folderId → name/path quickly
    const folderById = Object.fromEntries(allFolders.map((f) => [f.id, f]))

    return NextResponse.json({
      pending,
      failed,
      folders: allFolders,
      folderById,
    })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[GET /api/triage]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
