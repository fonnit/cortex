import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/**
 * Call text-embedding-3-small at 512 dimensions.
 * Returns one vector per input text in the same order.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
    dimensions: 512,
  })
  return response.data.map((d) => d.embedding)
}

interface EmbedItem {
  filename?: string | null
  axis_type?: string | null
  axis_from?: string | null
  source_metadata?: unknown
}

/**
 * Build a text string for embedding from item fields.
 * Concatenates non-null fields with ' | ' separator.
 * Falls back to filename or 'untitled' when all fields are null.
 *
 * SEED-v4-prod.md Decision 1 (260430-g6h): axis_context dropped from the
 * embed text — historical embeddings keep their old composition; new
 * embeddings compose from filename + axis_type + axis_from + subject.
 */
export function buildEmbedText(item: EmbedItem): string {
  const subject = extractSubject(item.source_metadata)
  const parts = [
    item.filename,
    item.axis_type,
    item.axis_from,
    subject,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)

  if (parts.length === 0) {
    return item.filename ?? 'untitled'
  }
  return parts.join(' | ')
}

function extractSubject(metadata: unknown): string | null {
  if (
    metadata !== null &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata)
  ) {
    const m = metadata as Record<string, unknown>
    if (typeof m['subject'] === 'string') return m['subject']
  }
  return null
}
