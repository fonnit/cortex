// Unit: the ClassificationSchema accepts good shapes and rejects bad ones.

import { ClassificationSchema } from '@/agent/src/classify'

describe('ClassificationSchema', () => {
  it('accepts a single proposal at high confidence', () => {
    const v = ClassificationSchema.parse({
      proposals: [{ folderId: 'fld_a', confidence: 0.95 }],
      proposedNewFolder: null,
    })
    expect(v.proposals).toHaveLength(1)
  })

  it('accepts up to 5 ranked proposals', () => {
    const v = ClassificationSchema.parse({
      proposals: [
        { folderId: 'a', confidence: 0.9 },
        { folderId: 'b', confidence: 0.7 },
        { folderId: 'c', confidence: 0.5 },
        { folderId: 'd', confidence: 0.3 },
        { folderId: 'e', confidence: 0.1 },
      ],
    })
    expect(v.proposals).toHaveLength(5)
  })

  it('rejects an empty proposals array', () => {
    expect(() => ClassificationSchema.parse({ proposals: [] })).toThrow()
  })

  it('rejects > 5 proposals', () => {
    expect(() =>
      ClassificationSchema.parse({
        proposals: Array.from({ length: 6 }, (_, i) => ({ folderId: `f${i}`, confidence: 0.5 })),
      }),
    ).toThrow()
  })

  it('rejects confidence > 1', () => {
    expect(() =>
      ClassificationSchema.parse({ proposals: [{ folderId: 'a', confidence: 1.5 }] }),
    ).toThrow()
  })

  it('accepts null proposedNewFolder and missing proposedNewFolder', () => {
    expect(() =>
      ClassificationSchema.parse({
        proposals: [{ folderId: 'a', confidence: 0.5 }],
        proposedNewFolder: null,
      }),
    ).not.toThrow()
    expect(() =>
      ClassificationSchema.parse({
        proposals: [{ folderId: 'a', confidence: 0.5 }],
      }),
    ).not.toThrow()
  })
})
