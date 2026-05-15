// Folder tree helpers. Three jobs:
//   1) getFolderTree() — full folder tree, used by worker classify prompt + triage UI.
//   2) getSampleFilenames() — one recent filed-item filename per top-level folder.
//      Lets the classify prompt show the user's actual naming style. Empty
//      folders contribute nothing (no static fallback per v2 design).
//   3) computeFolderPath(parentId, name) — derive Folder.path on insert.

import { prisma } from './prisma'
import { HttpError } from './http-error'

export type FolderTreeEntry = {
  id: string
  parentId: string | null
  name: string
  path: string
  isSeed: boolean
}

export async function getFolderTree(): Promise<FolderTreeEntry[]> {
  return prisma.folder.findMany({
    orderBy: { path: 'asc' },
    select: { id: true, parentId: true, name: true, path: true, isSeed: true },
  })
}

/**
 * For each top-level folder (depth-1 segment of Folder.path), returns the
 * most-recently-filed Item.finalFilename. Map keys are the top-level path
 * (e.g. "/business"), values are the bare filename (no extension).
 *
 * Implementation note: a single $queryRaw with DISTINCT ON keeps this fast
 * over the Neon HTTP transport (one statement, no transaction needed).
 */
export async function getSampleFilenames(): Promise<Record<string, string>> {
  const rows = await prisma.$queryRaw<Array<{ top_level: string; final_filename: string }>>`
    SELECT DISTINCT ON (split_part(f."path", '/', 2))
      '/' || split_part(f."path", '/', 2) AS top_level,
      i."finalFilename" AS final_filename
    FROM "Item" i
    JOIN "Folder" f ON f.id = i."folderId"
    WHERE i."finalFilename" IS NOT NULL
      AND i.status = 'filed'
    ORDER BY split_part(f."path", '/', 2), i."capturedAt" DESC
  `
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (r.top_level && r.top_level !== '/' && r.final_filename) {
      out[r.top_level] = r.final_filename
    }
  }
  return out
}

export async function computeFolderPath(
  parentId: string | null,
  name: string,
): Promise<string> {
  if (!parentId) return '/' + name

  const parent = await prisma.folder.findUnique({
    where: { id: parentId },
    select: { path: true },
  })
  if (!parent) throw new HttpError(404, 'Parent folder not found')

  return parent.path.replace(/\/$/, '') + '/' + name
}
