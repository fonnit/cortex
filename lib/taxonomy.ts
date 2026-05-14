// Folder tree helpers. Three jobs:
//   1) loadSeedTaxonomy() — read prisma/seeds/taxonomy-v4.json (used by seed.ts).
//   2) getFolderTreeForUser(userId) — fetch the user's full Folder tree for the
//      worker's classify prompt and the triage UI's folder picker.
//   3) computeFolderPath(parentId, name) — derive Folder.path on insert.
//      Called from /api/items/[id]/create-folder.

import { prisma } from './prisma'
import { HttpError } from './http-error'

export type FolderTreeEntry = {
  id: string
  parentId: string | null
  name: string
  path: string
  isSeed: boolean
}

export async function getFolderTreeForUser(userId: string): Promise<FolderTreeEntry[]> {
  const folders = await prisma.folder.findMany({
    where: { userId },
    orderBy: { path: 'asc' },
    select: { id: true, parentId: true, name: true, path: true, isSeed: true },
  })
  return folders
}

// Compute the Folder.path text for a newly-inserted folder given its parent.
// Top-level folders (parentId=null) have path = '/' + name.
// Throws HttpError(404) if parentId is provided but the parent doesn't exist
// or belongs to a different user.
export async function computeFolderPath(
  userId: string,
  parentId: string | null,
  name: string,
): Promise<string> {
  if (!parentId) return '/' + name

  const parent = await prisma.folder.findFirst({
    where: { id: parentId, userId },
    select: { path: true },
  })
  if (!parent) throw new HttpError(404, 'Parent folder not found')

  // Top-level parent has path "/Finance"; child path is "/Finance/Taxes".
  // The trailing slash case: parent.path '/' would only happen for a root
  // sentinel which we don't create.
  return parent.path.replace(/\/$/, '') + '/' + name
}
