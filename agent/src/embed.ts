// Worker-side embedding helper.
//
// Two responsibilities:
//   1) chunkText(text) — split a document into ~800-token chunks with ~100
//      token overlap. Docs under 800 tokens become a single chunk with no
//      overlap. We approximate tokens as 4 chars (OpenAI's rule-of-thumb).
//   2) embed(chunks) — one OpenAI batch call to text-embedding-3-small @ 512
//      dimensions. Returns Float arrays aligned 1:1 with the input chunks.
//
// The backend stores embeddings as halfvec(512) in pgvector; we hand it the
// raw number[] and the route formats + casts to halfvec server-side.

import OpenAI from 'openai'

const EMBED_MODEL = 'text-embedding-3-small'
const EMBED_DIMENSIONS = 512

// Approx 4 chars per token for English/Latin script. Slightly conservative
// (real ratios vary 3-5 chars/token); the model's hard cap is 8191 tokens
// per request input so 800 tokens × 4 chars = 3200 chars is well inside.
const CHARS_PER_TOKEN = 4
const TARGET_CHUNK_CHARS = 800 * CHARS_PER_TOKEN  // 3200
const OVERLAP_CHARS = 100 * CHARS_PER_TOKEN        // 400

export type Chunk = { ord: number; text: string }

/**
 * Split text into overlapping chunks. Empty or whitespace-only input returns
 * an empty array (the worker will mark such items as chunked with 0 chunks,
 * so they don't get re-claimed on every tick).
 */
export function chunkText(text: string): Chunk[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  if (trimmed.length <= TARGET_CHUNK_CHARS) {
    return [{ ord: 0, text: trimmed }]
  }

  const out: Chunk[] = []
  let cursor = 0
  let ord = 0
  while (cursor < trimmed.length) {
    const end = Math.min(cursor + TARGET_CHUNK_CHARS, trimmed.length)
    out.push({ ord, text: trimmed.slice(cursor, end) })
    ord++
    if (end >= trimmed.length) break
    cursor = end - OVERLAP_CHARS
  }
  return out
}

/**
 * Batch-embed an array of chunk texts. One API call regardless of input size
 * (OpenAI accepts arrays in `input`). Returns embeddings aligned 1:1 with
 * the input order. Throws on any API error — caller decides whether to
 * surface this as Item.chunkError.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const openai = new OpenAI()  // picks up OPENAI_API_KEY from env
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    dimensions: EMBED_DIMENSIONS,
    input: texts,
    encoding_format: 'float',
  })
  return res.data.map((d) => d.embedding as number[])
}
