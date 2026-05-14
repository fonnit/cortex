// Unit: computeFolderPath produces correct materialized paths.

jest.mock('@/lib/prisma', () => ({
  prisma: {
    folder: {
      findUnique: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { computeFolderPath } from '@/lib/taxonomy'

const findUnique = prisma.folder.findUnique as jest.Mock

describe('computeFolderPath', () => {
  beforeEach(() => {
    findUnique.mockReset()
  })

  it('returns / + name for a top-level folder', async () => {
    const result = await computeFolderPath(null, 'Finance')
    expect(result).toBe('/Finance')
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('appends to parent path', async () => {
    findUnique.mockResolvedValueOnce({ path: '/Finance' })
    const result = await computeFolderPath('parent-id', 'Taxes')
    expect(result).toBe('/Finance/Taxes')
  })

  it('handles deeply nested paths', async () => {
    findUnique.mockResolvedValueOnce({ path: '/Finance/Taxes' })
    const result = await computeFolderPath('parent-id', '2025')
    expect(result).toBe('/Finance/Taxes/2025')
  })

  it('throws 404 when parent missing', async () => {
    findUnique.mockResolvedValueOnce(null)
    await expect(computeFolderPath('unknown-parent', 'foo')).rejects.toMatchObject({
      status: 404,
    })
  })
})
