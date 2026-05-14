// Unit: text-extract dispatcher classifies file extensions correctly.

import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmp: string

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'cortex-test-'))
})

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('text-extract dispatch', () => {
  it('returns text mode for .txt', async () => {
    const { extract } = await import('@/agent/src/text-extract')
    const f = join(tmp, 'a.txt')
    await writeFile(f, 'hello cortex')
    const r = await extract(f)
    expect(r.kind).toBe('text')
    if (r.kind === 'text') expect(r.content).toBe('hello cortex')
  })

  it('returns text mode for .md', async () => {
    const { extract } = await import('@/agent/src/text-extract')
    const f = join(tmp, 'note.md')
    await writeFile(f, '# heading\n\nbody')
    const r = await extract(f)
    expect(r.kind).toBe('text')
  })

  it('returns image mode for .png path', async () => {
    const { extract } = await import('@/agent/src/text-extract')
    const f = join(tmp, 'pic.png')
    await writeFile(f, Buffer.from([0x89, 0x50, 0x4e, 0x47])) // PNG magic
    const r = await extract(f)
    expect(r.kind).toBe('image')
    if (r.kind === 'image') expect(r.path).toBe(f)
  })

  it('returns unsupported for unknown extensions', async () => {
    const { extract } = await import('@/agent/src/text-extract')
    const f = join(tmp, 'thing.numbers')
    await writeFile(f, 'fake content')
    const r = await extract(f)
    expect(r.kind).toBe('unsupported')
  })

  it('throws ENOENT when file is missing', async () => {
    const { extract } = await import('@/agent/src/text-extract')
    await expect(extract(join(tmp, 'missing.txt'))).rejects.toThrow()
  })
})
