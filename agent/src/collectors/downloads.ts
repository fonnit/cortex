// agent/src/collectors/downloads.ts — Phase 6 Plan 02 Task 3
// Watches WATCH_PATHS via chokidar + applies a startup recursive scan.
// Emits IngestRequest payloads to a callback — does NOT touch the API directly.
// The buffer + HTTP client live in agent/src/http/* (Plan 01); the main loop wires them.
//
// Locked rules (CONTEXT 06):
// - SCAN-01: unbounded recursion via walkDirectory
// - SCAN-02: skip subtrees containing .git or node_modules
// - SCAN-03: skip dotfiles
// - No DB, no Drive, no classification — daemon is a metadata producer only.

import { watch } from 'chokidar'
import { stat } from 'fs/promises'
import { createReadStream } from 'fs'
import path from 'path'
import crypto from 'crypto'
import type Langfuse from 'langfuse'

import { walkDirectory, shouldSkipDirectory } from '../scan.js'
import type { IngestRequest } from '../http/types.js'

const home = process.env.HOME ?? ''
const WATCH_PATHS = (process.env.WATCH_PATHS ?? `${home}/Downloads`)
  .split(',')
  .map((p) => p.trim().replace(/^~/, home))
  .filter(Boolean)
const DEBOUNCE_MS = 2000

async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    createReadStream(filePath)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

function inferMimeType(filePath: string): string | undefined {
  // Lightweight: extension-only. The API/consumer can override; the daemon does
  // not need libmagic to ship metadata.
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.dmg': 'application/x-apple-diskimage',
  }
  return ext ? map[ext] : undefined
}

async function buildPayload(filePath: string): Promise<IngestRequest | null> {
  try {
    const st = await stat(filePath)
    if (!st.isFile()) return null
    const content_hash = await sha256OfFile(filePath)
    const payload: IngestRequest = {
      source: 'downloads',
      content_hash,
      filename: path.basename(filePath),
      size_bytes: st.size,
      file_path: filePath,
    }
    const mime = inferMimeType(filePath)
    if (mime !== undefined) payload.mime_type = mime
    return payload
  } catch (err) {
    console.error(
      `[downloads] buildPayload failed for ${filePath}: ${(err as Error).message}`,
    )
    return null
  }
}

/**
 * Wire chokidar + a startup recursive scan against WATCH_PATHS. Each discovered
 * file becomes an IngestRequest payload that's pushed via `onPayload`.
 *
 * Returns a stop function that closes the watcher.
 */
export function startDownloadsCollector(
  langfuse: Langfuse,
  onPayload: (p: IngestRequest) => void,
): () => void {
  // chokidar `ignored`: skip dotfiles AND .git/node_modules trees at watcher level.
  const ignored = (testPath: string): boolean => {
    const base = path.basename(testPath)
    if (base.startsWith('.')) return true
    if (base === 'node_modules' || base === '.git') return true
    return false
  }

  const watcher = watch(WATCH_PATHS, {
    persistent: true,
    ignoreInitial: true, // initial state handled by the startup scan below
    ignored,
    awaitWriteFinish: { stabilityThreshold: DEBOUNCE_MS, pollInterval: 100 },
  })

  watcher.on('add', async (filePath) => {
    const payload = await buildPayload(filePath)
    if (payload) onPayload(payload)
  })

  watcher.on('error', (err: unknown) => {
    langfuse.trace({ name: 'fsevents_error', metadata: { error: String(err) } })
  })

  // Startup recursive scan — uses the new walker which already applies skip rules.
  ;(async () => {
    for (const root of WATCH_PATHS) {
      // Apply directory-level skip at the root too (in case the user pointed
      // WATCH_PATHS at a repo root).
      if (await shouldSkipDirectory(root)) continue
      for await (const filePath of walkDirectory(root)) {
        // walkDirectory already skipped hidden files + .git/node_modules trees.
        const payload = await buildPayload(filePath)
        if (payload) onPayload(payload)
      }
    }
  })().catch((err) => {
    langfuse.trace({ name: 'startup_scan_error', metadata: { error: String(err) } })
  })

  return () => {
    watcher.close().catch(() => {})
  }
}
