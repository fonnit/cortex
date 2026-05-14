// Walk a folder path and create any missing intermediate folders.
// Returns the leaf Folder's id. All inserts happen inside the provided
// transaction client; the caller is responsible for the transaction boundary.

import type { Prisma } from '@prisma/client'

const FolderNameSegment = /^[\w\s-]+$/u

export function isValidNewPath(p: string): boolean {
  if (!p.startsWith('/')) return false
  const segs = p.slice(1).split('/')
  if (segs.some((s) => s.length === 0)) return false
  return segs.every((s) => FolderNameSegment.test(s) && s.length <= 60)
}

export type EnsureResult = {
  leafFolderId: string
  createdFolderIds: string[]  // empty if the whole path already existed
  fullPath: string
}

// Walks `path` (e.g. '/Finance/Insurance/Auto') under `userId`, creating
// missing segments under the existing prefix in order. Returns the leaf id.
//
// Validates each segment matches the same rules as create-folder Zod.
// Sibling-uniqueness is enforced by the unique(userId, path) constraint.
export async function ensureFolderPath(
  tx: Prisma.TransactionClient,
  userId: string,
  path: string,
): Promise<EnsureResult> {
  if (!isValidNewPath(path)) {
    throw new Error(`invalid folder path: ${path}`)
  }
  const segments = path.slice(1).split('/')

  // Find the longest existing prefix
  let parentId: string | null = null
  let parentPath = ''
  let i = 0
  for (; i < segments.length; i++) {
    const tryPath = parentPath + '/' + segments[i]
    const existing = await tx.folder.findFirst({
      where: { userId, path: tryPath },
      select: { id: true },
    })
    if (!existing) break
    parentId = existing.id
    parentPath = tryPath
  }

  if (i === segments.length) {
    // Whole path already exists
    return { leafFolderId: parentId!, createdFolderIds: [], fullPath: path }
  }

  // Create the missing segments [i..end]
  const created: string[] = []
  for (let j = i; j < segments.length; j++) {
    const name = segments[j]
    const newPath = parentPath + '/' + name
    const inserted = await tx.folder.create({
      data: {
        userId,
        parentId,
        name,
        path: newPath,
        isSeed: false,
      },
      select: { id: true },
    })
    parentId = inserted.id
    parentPath = newPath
    created.push(inserted.id)
  }

  return { leafFolderId: parentId!, createdFolderIds: created, fullPath: parentPath }
}
