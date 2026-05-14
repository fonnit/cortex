// ETag-cached folder tree for the worker's classify prompt.
// Per Performance finding 4A discussion: keep simple. Refetch on every poll
// (304 short-circuit ensures only ~5kb HEAD payload when stable).

import { apiFetch } from './clerk-m2m.js'
import type { FolderEntry } from './classify.js'

let cached: { etag: string | null; folders: FolderEntry[] } = { etag: null, folders: [] }

export async function fetchFolders(): Promise<FolderEntry[]> {
  const headers: Record<string, string> = {}
  if (cached.etag) headers['If-None-Match'] = cached.etag

  const res = await apiFetch('/api/taxonomy', { method: 'GET', headers })

  if (res.status === 304) return cached.folders
  if (res.status !== 200) {
    throw new Error(`/api/taxonomy fetch failed: ${res.status}`)
  }

  const newEtag = res.headers.get('etag')
  const { folders } = (await res.json()) as { folders: FolderEntry[] }
  cached = { etag: newEtag, folders }
  return folders
}
