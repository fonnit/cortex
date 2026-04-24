/** Returns the set of overlapping trigrams / total unique trigrams (Jaccard on trigrams). */
export function trigramSimilarity(a: string, b: string): number {
  const trigrams = (s: string) => {
    const padded = `  ${s.toLowerCase()}  `
    const set = new Set<string>()
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3))
    return set
  }
  const ta = trigrams(a), tb = trigrams(b)
  const intersection = [...ta].filter(t => tb.has(t)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

/** Token-level Jaccard: splits on non-alphanumeric characters. */
export function jaccardSimilarity(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  const ta = tokens(a), tb = tokens(b)
  const intersection = [...ta].filter(t => tb.has(t)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

/** Composite similarity: max of trigram and Jaccard. */
export function labelSimilarity(a: string, b: string): number {
  return Math.max(trigramSimilarity(a, b), jaccardSimilarity(a, b))
}
