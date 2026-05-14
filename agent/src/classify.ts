// Anthropic SDK + Claude Haiku 4.5 classification.
//
// Multimodal: text mode embeds the document in the prompt body; image/pdf_native
// modes pass the file as a multimodal content block.
//
// Output is JSON-validated with Zod. The model is instructed to pick from the
// known folder tree IDs only; a strict-retry suffix is NOT added (per Architecture
// finding 1C — single attempt per worker pickup, sweep handles retry).

import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { ExtractResult } from './text-extract.js'

const MODEL = process.env.CORTEX_CLASSIFY_MODEL || 'claude-haiku-4-6'

const FolderEntry = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  path: z.string(),
  isSeed: z.boolean(),
})
export type FolderEntry = z.infer<typeof FolderEntry>

export const ClassificationSchema = z.object({
  proposals: z
    .array(z.object({ folderId: z.string(), confidence: z.number().min(0).max(1) }))
    .min(1)
    .max(5),
  proposedNewFolder: z.string().nullable().optional(),
})
export type Classification = z.infer<typeof ClassificationSchema>

const TIMEOUT_MS = 300_000  // 5 min per plan finding 1C

function buildSystemPrompt(folders: FolderEntry[]): string {
  const tree = folders.map((f) => `  - ${f.id}\t${f.path}`).join('\n')
  return [
    `You are a personal archive classifier for a user named Daniel Fonnegra.`,
    `Your job: given a document, pick the best-fit folder(s) for it.`,
    ``,
    `Output STRICTLY a JSON object matching this schema:`,
    `{`,
    `  "proposals": [{"folderId": <STRING from the FOLDER TREE>, "confidence": <0.0..1.0>}, ...],`,
    `  "proposedNewFolder": <STRING | null>`,
    `}`,
    ``,
    `Rules:`,
    `- proposals MUST be an array of length 1..5, strictly descending by confidence.`,
    `- If you are highly confident (>= 0.9) about the top pick, you MAY return only one entry.`,
    `- Otherwise, return 2-5 ranked alternatives. The user will pick.`,
    `- Every proposals[N].folderId MUST be one of the IDs from the FOLDER TREE below.`,
    `- If you think a new folder would be a better fit, set proposedNewFolder to the suggested name`,
    `  (single segment, snake-or-kebab-case, e.g. "auto-insurance"). Otherwise null.`,
    `- Do NOT invent folder IDs. Do NOT add commentary. Output ONLY the JSON object.`,
    ``,
    `FOLDER TREE (id\tpath):`,
    tree,
  ].join('\n')
}

function buildUserContentText(extracted: Extract<ExtractResult, { kind: 'text' }>, meta: FileMeta): Anthropic.MessageParam['content'] {
  return [
    {
      type: 'text',
      text:
        `FILE METADATA:\n` +
        `  filename: ${meta.basename}\n` +
        `  mimeType: ${meta.mimeType ?? 'unknown'}\n` +
        `  sizeBytes: ${meta.sizeBytes}\n\n` +
        `EXTRACTED TEXT (first ${extracted.extractedCharCount} chars):\n${extracted.content}`,
    },
  ]
}

async function buildUserContentImage(
  extracted: Extract<ExtractResult, { kind: 'image' }>,
  meta: FileMeta,
): Promise<Anthropic.MessageParam['content']> {
  const buf = await readFile(extracted.path)
  const mediaType = guessImageMediaType(extracted.path)
  return [
    {
      type: 'text',
      text:
        `FILE METADATA:\n` +
        `  filename: ${meta.basename}\n` +
        `  mimeType: ${meta.mimeType ?? mediaType}\n` +
        `  sizeBytes: ${meta.sizeBytes}\n\n` +
        `The document image is attached. Classify based on its visual content.`,
    },
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') },
    },
  ]
}

async function buildUserContentPdf(
  extracted: Extract<ExtractResult, { kind: 'pdf_native' }>,
  meta: FileMeta,
): Promise<Anthropic.MessageParam['content']> {
  const buf = await readFile(extracted.path)
  const blocks = [
    {
      type: 'text' as const,
      text:
        `FILE METADATA:\n` +
        `  filename: ${meta.basename}\n` +
        `  mimeType: application/pdf\n` +
        `  sizeBytes: ${meta.sizeBytes}\n\n` +
        `The PDF is attached natively (no text layer was extractable). Classify based on its visual content.`,
    },
    {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
    },
  ]
  return blocks as unknown as Anthropic.MessageParam['content']
}

function guessImageMediaType(p: string): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  const lower = p.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

export type FileMeta = {
  basename: string
  mimeType: string | null
  sizeBytes: number
}

export async function classify(
  extracted: ExtractResult,
  folders: FolderEntry[],
  meta: FileMeta,
): Promise<Classification> {
  if (extracted.kind === 'unsupported') {
    throw new Error(`classify() called on unsupported extraction: ${extracted.reason}`)
  }

  const anthropic = new Anthropic()

  let content: Anthropic.MessageParam['content']
  if (extracted.kind === 'text') content = buildUserContentText(extracted, meta)
  else if (extracted.kind === 'image') content = await buildUserContentImage(extracted, meta)
  else content = await buildUserContentPdf(extracted, meta)

  const response = await anthropic.messages.create(
    {
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(folders),
      messages: [{ role: 'user', content }],
    },
    { timeout: TIMEOUT_MS },
  )

  const textBlock = response.content.find((b) => b.type === 'text') as
    | { type: 'text'; text: string }
    | undefined
  if (!textBlock) throw new Error('Claude returned no text block')

  // Strip code fences if any
  const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '')
  const json = JSON.parse(raw)
  const parsed = ClassificationSchema.parse(json)

  // Validate proposals are descending by confidence (the prompt asks for it but
  // models sometimes drift; sort if needed rather than reject)
  parsed.proposals.sort((a, b) => b.confidence - a.confidence)

  return parsed
}
