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

/** Exposed so one-shot scripts can build the same payload the daemon does (no service-layer duplication). */
export async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    createReadStream(filePath)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/** Exposed for one-shot scripts. Extension-only inference — see comment above. */
export function inferMimeType(filePath: string): string | undefined {
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

/**
 * Build an IngestRequest from a file path the same way the chokidar collector
 * does. Exposed for one-shot scripts (e.g. scripts/process-files.ts) so they
 * use the same hashing + mime-inference logic as the daemon.
 */
export async function buildPayload(filePath: string): Promise<IngestRequest | null> {
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
 * Returns true if `candidate` is `prefix` itself or a descendant path of
 * `prefix` (joined by `path.sep`). Used to enforce SCAN-02 at runtime: any
 * path under a known skip-prefix must be ignored, even if the path itself
 * doesn't have `.git` / `node_modules` in its basename.
 *
 * Exported for unit testing.
 */
export function isUnderSkipPrefix(candidate: string, skipPrefixes: Set<string>): boolean {
  for (const prefix of skipPrefixes) {
    if (candidate === prefix) return true
    if (candidate.startsWith(prefix + path.sep)) return true
  }
  return false
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
  // SCAN-02 runtime enforcement (MJ-02): chokidar's `ignored` predicate is
  // synchronous and only sees the path string, so it cannot itself stat the
  // ancestor chain. We maintain a Set of "skip prefixes" — directory paths
  // known to contain `.git` / `node_modules` as a direct child — and the
  // predicate rejects any candidate that lives under one of them. The set is
  // populated:
  //   1) by the startup recursive scan (below), which discovers every existing
  //      repo subtree under WATCH_PATHS up front, AND
  //   2) by chokidar `addDir` events at runtime, which fire before any `add`
  //      under a newly-discovered subdirectory.
  // The `add` handler also performs a defensive `shouldSkipDirectory` check on
  // the immediate parent to close any residual race window.
  const skipPrefixes = new Set<string>()

  // chokidar `ignored`: skip dotfiles, names matching `.git`/`node_modules`
  // directly, AND any path under a known skip prefix (the SCAN-02 tree-skip).
  const ignored = (testPath: string): boolean => {
    const base = path.basename(testPath)
    if (base.startsWith('.')) return true
    if (base === 'node_modules' || base === '.git') return true
    if (isUnderSkipPrefix(testPath, skipPrefixes)) return true
    return false
  }

  const watcher = watch(WATCH_PATHS, {
    persistent: true,
    ignoreInitial: true, // initial state handled by the startup scan below
    ignored,
    // MN-04: align with walkDirectory's symlink-skip behaviour. The startup
    // walker uses Dirent.isDirectory() (no symlink follow). chokidar's default
    // is followSymlinks=true, which can produce infinite-recursion / event
    // floods on cyclic symlinks. We mirror the walker.
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: DEBOUNCE_MS, pollInterval: 100 },
  })

  // Maintain the skip-prefix set as chokidar discovers directories. addDir
  // fires before any `add` under that directory, so the predicate above will
  // see the prefix in time for descendant events.
  watcher.on('addDir', async (dirPath) => {
    try {
      if (await shouldSkipDirectory(dirPath)) skipPrefixes.add(dirPath)
    } catch {
      // shouldSkipDirectory already swallows readdir errors and returns true
      // on EACCES/ENOENT; if anything else throws, fail-open here — the `add`
      // handler will re-check on each file event.
    }
  })

  watcher.on('unlinkDir', (dirPath) => {
    skipPrefixes.delete(dirPath)
  })

  watcher.on('add', async (filePath) => {
    // Defensive SCAN-02 check at the file event: if the immediate parent is a
    // repo root (contains .git / node_modules), skip. This closes the chokidar
    // ordering race where `add` may fire before `addDir` registered the parent.
    const parentDir = path.dirname(filePath)
    if (await shouldSkipDirectory(parentDir)) {
      skipPrefixes.add(parentDir)
      return
    }
    if (isUnderSkipPrefix(filePath, skipPrefixes)) return
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
      // WATCH_PATHS at a repo root). Also seed the skip-prefix set so any
      // runtime event under that root is rejected by `ignored`.
      if (await shouldSkipDirectory(root)) {
        skipPrefixes.add(root)
        continue
      }
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
