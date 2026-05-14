// Folder tree helpers. Two jobs:
//   1) getFolderTree() — full folder tree, used by worker classify prompt + triage UI.
//   2) computeFolderPath(parentId, name) — derive Folder.path on insert.

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
