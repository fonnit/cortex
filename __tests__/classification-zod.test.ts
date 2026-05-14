// Unit: the ClassificationRawSchema accepts good shapes and rejects bad ones.

import { ClassificationRawSchema } from '@/agent/src/classify'

describe('ClassificationRawSchema', () => {
  it('accepts a single existing proposal at high confidence', () => {
    const v = ClassificationRawSchema.parse({
      proposals: [{ kind: 'existing', path: '/Finance', confidence: 0.95 }],
    })
    expect(v.proposals).toHaveLength(1)
  })

  it('accepts a mix of existing and new proposals', () => {
    const v = ClassificationRawSchema.parse({
      proposals: [
        { kind: 'existing', path: '/Finance/Banking', confidence: 0.85 },
        { kind: 'new', path: '/Finance/Insurance/Auto', confidence: 0.62 },
        { kind: 'existing', path: '/Personal', confidence: 0.30 },
      ],
    })
    expect(v.proposals).toHaveLength(3)
    expect(v.proposals[1].kind).toBe('new')
  })

  it('accepts up to 5 ranked proposals', () => {
    const v = ClassificationRawSchema.parse({
      proposals: Array.from({ length: 5 }, (_, i) => ({
        kind: 'existing' as const,
        path: '/p' + i,
        confidence: 0.9 - i * 0.1,
      })),
    })
    expect(v.proposals).toHaveLength(5)
  })

  it('rejects an empty proposals array', () => {
    expect(() => ClassificationRawSchema.parse({ proposals: [] })).toThrow()
  })

  it('rejects > 5 proposals', () => {
    expect(() =>
      ClassificationRawSchema.parse({
        proposals: Array.from({ length: 6 }, (_, i) => ({
          kind: 'existing' as const,
          path: '/p' + i,
          confidence: 0.5,
        })),
      }),
    ).toThrow()
  })

  it('rejects confidence > 1', () => {
    expect(() =>
      ClassificationRawSchema.parse({
        proposals: [{ kind: 'existing', path: '/a', confidence: 1.5 }],
      }),
    ).toThrow()
  })

  it('rejects an unknown kind', () => {
    expect(() =>
      ClassificationRawSchema.parse({
        proposals: [{ kind: 'maybe', path: '/a', confidence: 0.5 }],
      }),
    ).toThrow()
  })
})
