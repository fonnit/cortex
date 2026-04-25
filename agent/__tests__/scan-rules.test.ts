/**
 * agent/src/scan.ts unit tests — Phase 6 Plan 02 Task 2
 *
 * Validates the recursive directory walker + skip rules:
 * - SCAN-01: unbounded recursion
 * - SCAN-02: skip subtrees containing .git or node_modules
 * - SCAN-03: skip files whose basename starts with `.`
 *
 * Tests use real fs operations under os.tmpdir() (cleaned up between cases)
 * with jest.spyOn for the rare permission-error case.
 */

import { mkdir, mkdtemp, writeFile, rm } from 'fs/promises'
import path from 'path'
import os from 'os'

import { shouldSkipFile, shouldSkipDirectory, walkDirectory } from '../src/scan'

// Each test gets a fresh tmpdir under /tmp/cortex-scan-test-<rand>
let testRoot = ''

async function makeFile(rel: string, content = 'x'): Promise<string> {
  const full = path.join(testRoot, rel)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, content)
  return full
}

async function makeDir(rel: string): Promise<string> {
  const full = path.join(testRoot, rel)
  await mkdir(full, { recursive: true })
  return full
}

beforeEach(async () => {
  testRoot = await mkdtemp(path.join(os.tmpdir(), 'cortex-scan-test-'))
})

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true }).catch(() => {})
})

describe('agent/src/scan — shouldSkipFile', () => {
  it('Test 1: skips dotfiles by basename', () => {
    expect(shouldSkipFile('.DS_Store')).toBe(true)
    expect(shouldSkipFile('.gitignore')).toBe(true)
    expect(shouldSkipFile('.env')).toBe(true)
    expect(shouldSkipFile('invoice.pdf')).toBe(false)
    expect(shouldSkipFile('Image 1.png')).toBe(false)
  })

  it('Test 2: only basename matters (intermediate dot-dirs handled by shouldSkipDirectory)', () => {
    expect(shouldSkipFile('/Users/x/.config/foo.txt')).toBe(false)
    expect(shouldSkipFile('/some/where/.hidden')).toBe(true)
  })
})

describe('agent/src/scan — shouldSkipDirectory', () => {
  it('Test 3: skips when .git is a direct child', async () => {
    await makeFile('repo/.git/HEAD')
    expect(await shouldSkipDirectory(path.join(testRoot, 'repo'))).toBe(true)
  })

  it('Test 4: skips when node_modules is a direct child', async () => {
    await makeFile('proj/node_modules/foo/index.js')
    expect(await shouldSkipDirectory(path.join(testRoot, 'proj'))).toBe(true)
  })

  it('Test 5: does NOT skip when neither marker is present', async () => {
    await makeFile('normal/a.txt')
    await makeFile('normal/b.pdf')
    expect(await shouldSkipDirectory(path.join(testRoot, 'normal'))).toBe(false)
  })
})

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = []
  for await (const p of gen) out.push(p)
  return out.sort()
}

describe('agent/src/scan — walkDirectory', () => {
  it('Test 6: recurses unbounded', async () => {
    await makeFile('a/b/c/d/e/deep.txt')
    await makeFile('a/top.txt')
    await makeFile('a/b/mid.txt')
    await makeFile('a/b/c/m2.txt')
    await makeFile('a/b/c/d/m3.txt')

    const files = await collect(walkDirectory(testRoot))
    expect(files).toHaveLength(5)
    expect(files.some((f) => f.endsWith('deep.txt'))).toBe(true)
  })

  it('Test 7: skips entire .git tree', async () => {
    await makeFile('repo/.git/HEAD')
    await makeFile('repo/src/main.ts')
    await makeFile('normal/file.txt')

    const files = await collect(walkDirectory(testRoot))
    expect(files).toEqual([path.join(testRoot, 'normal/file.txt')])
  })

  it('Test 8: skips entire node_modules tree', async () => {
    await makeFile('proj/node_modules/x/index.js')
    await makeFile('proj/src/y.ts')
    await makeFile('loose.txt')

    const files = await collect(walkDirectory(testRoot))
    expect(files).toEqual([path.join(testRoot, 'loose.txt')])
  })

  it('Test 9: skips hidden files', async () => {
    await makeFile('normal/file.txt')
    await makeFile('normal/.hidden')

    const files = await collect(walkDirectory(testRoot))
    expect(files).toEqual([path.join(testRoot, 'normal/file.txt')])
  })

  it('Test 10: recurses into normal subdirs', async () => {
    await makeFile('a/b/c/file.txt')

    const files = await collect(walkDirectory(testRoot))
    expect(files).toEqual([path.join(testRoot, 'a/b/c/file.txt')])
  })

  it('Test 11: handles missing path gracefully (no throw)', async () => {
    const files = await collect(walkDirectory('/path/does/not/exist/cortex-test'))
    expect(files).toEqual([])
  })

  it('Test 12: handles permission error on a subdir gracefully', async () => {
    await makeFile('readable/keep.txt')
    await makeDir('blocked')

    // Suppress noisy console.error from the walker's catch branch.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    // Make `blocked` unreadable. On macOS removing read+execute bits triggers EACCES on readdir.
    const blockedAbs = path.join(testRoot, 'blocked')
    const { chmod } = await import('fs/promises')
    await chmod(blockedAbs, 0o000)

    try {
      const files = await collect(walkDirectory(testRoot))
      expect(files).toEqual([path.join(testRoot, 'readable/keep.txt')])
      expect(errSpy).toHaveBeenCalled()
    } finally {
      // Restore perms so afterEach can clean up.
      await chmod(blockedAbs, 0o755).catch(() => {})
      errSpy.mockRestore()
    }
  })
})
