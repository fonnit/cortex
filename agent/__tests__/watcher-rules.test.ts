/**
 * agent/src/collectors/downloads.ts — runtime watcher rule tests.
 *
 * Validates the SCAN-02 tree-skip enforcement at runtime (MJ-02):
 * - `isUnderSkipPrefix` correctly rejects candidates living under any known
 *   skip-prefix (a directory that contains `.git` or `node_modules` as a
 *   direct child).
 * - Real `shouldSkipDirectory` correctly identifies repo roots so the watcher
 *   wiring (addDir / add fallback) can populate the skip-prefix set from
 *   real filesystem state.
 *
 * The chokidar runtime loop itself requires actual fsevents and is exercised
 * via Phase 8 acceptance tests; these unit tests cover the predicate logic
 * the loop depends on.
 */

import { mkdir, mkdtemp, writeFile, rm } from 'fs/promises'
import path from 'path'
import os from 'os'

// chokidar v5 is ESM-only; ts-jest runs under CommonJS. We don't exercise the
// watcher loop here (Phase 8 acceptance covers that), only the predicate logic
// that the loop composes — so a no-op mock unblocks the import.
jest.mock('chokidar', () => ({ watch: jest.fn() }))

import { isUnderSkipPrefix } from '../src/collectors/downloads'
import { shouldSkipDirectory } from '../src/scan'

let testRoot = ''

async function makeFile(rel: string, content = 'x'): Promise<string> {
  const full = path.join(testRoot, rel)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, content)
  return full
}

beforeEach(async () => {
  testRoot = await mkdtemp(path.join(os.tmpdir(), 'cortex-watcher-test-'))
})

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true }).catch(() => {})
})

describe('downloads — isUnderSkipPrefix', () => {
  it('returns false on an empty skip set', () => {
    expect(isUnderSkipPrefix('/foo/bar/baz.pdf', new Set())).toBe(false)
  })

  it('returns true when candidate equals a skip prefix', () => {
    const prefixes = new Set(['/Users/me/Downloads/some-repo'])
    expect(isUnderSkipPrefix('/Users/me/Downloads/some-repo', prefixes)).toBe(true)
  })

  it('returns true when candidate is a descendant of a skip prefix', () => {
    const prefixes = new Set(['/Users/me/Downloads/some-repo'])
    expect(
      isUnderSkipPrefix('/Users/me/Downloads/some-repo/src/file.pdf', prefixes),
    ).toBe(true)
    expect(
      isUnderSkipPrefix('/Users/me/Downloads/some-repo/.git/HEAD', prefixes),
    ).toBe(true)
  })

  it('returns false when candidate is a sibling of (not under) a skip prefix', () => {
    const prefixes = new Set(['/Users/me/Downloads/some-repo'])
    expect(
      isUnderSkipPrefix('/Users/me/Downloads/other-file.pdf', prefixes),
    ).toBe(false)
    // Adjacent dir whose name SHARES a prefix string but is not a real descendant
    expect(
      isUnderSkipPrefix('/Users/me/Downloads/some-repository/file.pdf', prefixes),
    ).toBe(false)
  })

  it('returns true when candidate is under any of multiple skip prefixes', () => {
    const prefixes = new Set([
      '/Users/me/Downloads/repo-a',
      '/Users/me/Downloads/nested/repo-b',
    ])
    expect(isUnderSkipPrefix('/Users/me/Downloads/repo-a/x.txt', prefixes)).toBe(true)
    expect(
      isUnderSkipPrefix('/Users/me/Downloads/nested/repo-b/src/y.ts', prefixes),
    ).toBe(true)
    expect(isUnderSkipPrefix('/Users/me/Downloads/other.pdf', prefixes)).toBe(false)
  })
})

describe('downloads — SCAN-02 watcher predicate against real filesystem (MJ-02)', () => {
  it('shouldSkipDirectory + isUnderSkipPrefix together reject files under a .git tree', async () => {
    // ~/Downloads/some-repo/.git/HEAD  (skip the whole subtree)
    // ~/Downloads/some-repo/src/foo.pdf  (would otherwise be enqueued)
    await makeFile('some-repo/.git/HEAD')
    const filePath = await makeFile('some-repo/src/foo.pdf')
    const repoDir = path.join(testRoot, 'some-repo')

    // The watcher's addDir handler would call shouldSkipDirectory(repoDir)
    // and add it to the skip-prefix set:
    expect(await shouldSkipDirectory(repoDir)).toBe(true)
    const skipPrefixes = new Set<string>()
    if (await shouldSkipDirectory(repoDir)) skipPrefixes.add(repoDir)

    // Now any file event under that subtree should be rejected by the
    // composite predicate (basename rule + isUnderSkipPrefix), reproducing
    // the exact logic in `ignored`:
    expect(isUnderSkipPrefix(filePath, skipPrefixes)).toBe(true)
  })

  it('shouldSkipDirectory + isUnderSkipPrefix together reject files under a node_modules tree', async () => {
    await makeFile('proj/node_modules/x/index.js')
    const filePath = await makeFile('proj/src/keep.pdf')
    const projDir = path.join(testRoot, 'proj')

    expect(await shouldSkipDirectory(projDir)).toBe(true)
    const skipPrefixes = new Set<string>()
    skipPrefixes.add(projDir)

    expect(isUnderSkipPrefix(filePath, skipPrefixes)).toBe(true)
    expect(
      isUnderSkipPrefix(path.join(projDir, 'node_modules', 'x', 'index.js'), skipPrefixes),
    ).toBe(true)
  })

  it('shouldSkipDirectory does NOT mark a normal directory as skip — files there are kept', async () => {
    await makeFile('normal/a.txt')
    await makeFile('normal/b.pdf')
    const normalDir = path.join(testRoot, 'normal')

    expect(await shouldSkipDirectory(normalDir)).toBe(false)
    const skipPrefixes = new Set<string>()
    if (await shouldSkipDirectory(normalDir)) skipPrefixes.add(normalDir)

    expect(skipPrefixes.size).toBe(0)
    expect(isUnderSkipPrefix(path.join(normalDir, 'a.txt'), skipPrefixes)).toBe(false)
  })
})
