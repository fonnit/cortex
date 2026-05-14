// Unit: computeFolderPath produces correct materialized paths.
// Uses jest.mock to stub the prisma client.

jest.mock('@/lib/prisma', () => ({
  prisma: {
    folder: {
      findFirst: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { computeFolderPath } from '@/lib/taxonomy'

const findFirst = prisma.folder.findFirst as jest.Mock

describe('computeFolderPath', () => {
  beforeEach(() => {
    findFirst.mockReset()
  })

  it('returns / + name for a top-level folder', async () => {
    const result = await computeFolderPath('u1', null, 'Finance')
    expect(result).toBe('/Finance')
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('appends to parent path', async () => {
    findFirst.mockResolvedValueOnce({ path: '/Finance' })
    const result = await computeFolderPath('u1', 'parent-id', 'Taxes')
    expect(result).toBe('/Finance/Taxes')
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'parent-id', userId: 'u1' },
      select: { path: true },
    })
  })

  it('handles deeply nested paths', async () => {
    findFirst.mockResolvedValueOnce({ path: '/Finance/Taxes' })
    const result = await computeFolderPath('u1', 'parent-id', '2025')
    expect(result).toBe('/Finance/Taxes/2025')
  })

  it('throws 404 when parent missing for that user', async () => {
    findFirst.mockResolvedValueOnce(null)
    await expect(computeFolderPath('u1', 'unknown-parent', 'foo')).rejects.toMatchObject({
      status: 404,
    })
  })
})
