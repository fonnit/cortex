// agent/src/scan.ts — Phase 6 Plan 02 Task 2
// Recursive directory walker with .git / node_modules tree-skip and hidden-file skip.
// Pure — no Langfuse, no HTTP, no Neon. Used by collectors/downloads.ts.
//
// Rules (locked in CONTEXT 06):
// - SCAN-01: unbounded recursion
// - SCAN-02: if a directory contains `.git` OR `node_modules` as a direct child,
//            skip the entire subtree (do NOT enqueue any file under it).
// - SCAN-03: skip files whose basename starts with `.` (covers .DS_Store, dotfiles).

import { readdir } from 'fs/promises'
import path from 'path'

/**
 * Skip files whose basename starts with `.`.
 *
 * Only the basename matters here — intermediate dot-dirs in a path are handled
 * by `shouldSkipDirectory` walking the tree, not by this predicate.
 */
export function shouldSkipFile(filePathOrName: string): boolean {
  const basename = path.basename(filePathOrName)
  return basename.startsWith('.')
}

/**
 * Skip a directory tree if the directory contains `.git` OR `node_modules` as
 * a direct child *directory* entry. Returns true on EACCES / ENOENT (treat as
 * "skip").
 *
 * The `isDirectory()` check matters: a regular file literally named
 * `node_modules` (no extension) is rare but real (e.g. a saved npm index page)
 * and must NOT cause the entire enclosing tree to be skipped.
 */
export async function shouldSkipDirectory(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.some(
      (e) => (e.name === '.git' || e.name === 'node_modules') && e.isDirectory(),
    )
  } catch {
    // EACCES / ENOENT — caller will skip; treat as "skip this dir".
    return true
  }
}

/**
 * Recursively yield absolute file paths under `root`, applying skip rules.
 * Unbounded depth. Symlinks are ignored to avoid cycles (chokidar default).
 *
 * The tree-skip rule is applied BEFORE descending into children: if `root`
 * contains `.git` or `node_modules` as a direct child, the whole subtree is
 * skipped. Read errors (EACCES/ENOENT) on a subdir are logged and the walker
 * moves on — never throws into the caller.
 */
export async function* walkDirectory(root: string): AsyncGenerator<string> {
  let entries: import('fs').Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err) {
    // ENOENT / EACCES — log and stop walking this branch.
    console.error(`[scan] walkDirectory: cannot read ${root}: ${(err as Error).message}`)
    return
  }

  // Apply tree-skip rule at THIS level: if root itself contains .git or
  // node_modules as a *directory*, abort the subtree. The isDirectory() check
  // mirrors shouldSkipDirectory — a file named `.git` or `node_modules` should
  // not trigger a tree-wide skip.
  if (
    entries.some(
      (e) => (e.name === '.git' || e.name === 'node_modules') && e.isDirectory(),
    )
  ) {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      // Recurse — child directory will be tested again by its own walkDirectory call.
      yield* walkDirectory(fullPath)
    } else if (entry.isFile()) {
      if (shouldSkipFile(entry.name)) continue
      yield fullPath
    }
    // Symlinks: ignored. Avoids cycles.
  }
}
