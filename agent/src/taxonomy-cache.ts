// ETag-cached taxonomy snapshot for the worker's classify prompt.
// Refetches on every classify tick; 304 short-circuits if nothing changed.

import { apiFetch } from './clerk-m2m.js'
import type { FolderEntry, Taxonomy } from './classify.js'

let cached: { etag: string | null; taxonomy: Taxonomy } = {
  etag: null,
  taxonomy: { folders: [], sampleFilenames: {} },
}

export async function fetchTaxonomy(): Promise<Taxonomy> {
  const headers: Record<string, string> = {}
  if (cached.etag) headers['If-None-Match'] = cached.etag

  const res = await apiFetch('/api/taxonomy', { method: 'GET', headers })

  if (res.status === 304) return cached.taxonomy
  if (res.status !== 200) {
    throw new Error(`/api/taxonomy fetch failed: ${res.status}`)
  }

  const newEtag = res.headers.get('etag')
  const body = (await res.json()) as { folders: FolderEntry[]; sampleFilenames?: Record<string, string> }
  cached = {
    etag: newEtag,
    taxonomy: { folders: body.folders, sampleFilenames: body.sampleFilenames ?? {} },
  }
  return cached.taxonomy
}
