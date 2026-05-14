#!/usr/bin/env node
// cortex add — CLI to enqueue a file for triage.
// Usage:
//   cortex-add /path/to/file.pdf
//
// Hashes the file (SHA256), POSTs metadata to /api/items. Does NOT move/copy
// the file. The worker re-hashes at classify time and again at move time.

import { stat } from 'node:fs/promises'
import { resolve, basename, extname } from 'node:path'
import { apiFetch } from './clerk-m2m.js'
import { sha256File } from './hash.js'

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: cortex add <path>')
    process.exit(2)
  }
  const sourcePath = resolve(arg)

  let stats
  try {
    stats = await stat(sourcePath)
  } catch (e) {
    console.error(`File not found: ${sourcePath}`)
    process.exit(1)
  }
  if (!stats.isFile()) {
    console.error(`Not a file: ${sourcePath}`)
    process.exit(1)
  }

  const ext = extname(sourcePath).toLowerCase()
  const mimeType = MIME_BY_EXT[ext] ?? null
  const hash = await sha256File(sourcePath)

  const res = await apiFetch('/api/items', {
    method: 'POST',
    json: { sourcePath, sha256: hash, mimeType, sizeBytes: stats.size },
  })

  if (res.status === 200) {
    const { item } = (await res.json()) as { item: { id: string; status: string } }
    console.log(`enqueued: ${basename(sourcePath)} (id=${item.id}, status=${item.status})`)
    return
  }
  if (res.status === 409) {
    const { item } = (await res.json()) as { item?: { id: string; status: string } }
    if (item) console.log(`duplicate: already added as ${item.id} (status=${item.status})`)
    else console.log('duplicate (already added)')
    return
  }

  const body = await res.text().catch(() => '')
  console.error(`add failed: ${res.status} ${body}`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
