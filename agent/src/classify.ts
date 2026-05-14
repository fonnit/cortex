// Anthropic SDK + Claude Haiku classification.
//
// Output shape: 1-5 ranked proposals, each EITHER an existing folder path or
// a new folder path. The worker maps existing paths → folderIds against its
// cached taxonomy after parse; the server re-validates.
//
// Multimodal: text mode embeds the document in the prompt body; image and
// pdf_native modes pass the file as a multimodal content block.

import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { ExtractResult } from './text-extract.js'

const MODEL = process.env.CORTEX_CLASSIFY_MODEL || 'claude-haiku-4-5'

export const FolderEntrySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  path: z.string(),
  isSeed: z.boolean(),
})
export type FolderEntry = z.infer<typeof FolderEntrySchema>

// Model output (raw): paths only, no folderIds. Worker resolves paths after.
const ProposalRawSchema = z.object({
  kind: z.enum(['existing', 'new']),
  path: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export const ClassificationRawSchema = z.object({
  proposals: z.array(ProposalRawSchema).min(1).max(5),
})
export type ClassificationRaw = z.infer<typeof ClassificationRawSchema>

// Final shape after the worker resolves paths against the cached folder tree:
//   - existing: folderId resolved from path
//   - new: path is kept as-is; folder will be created at approve time
export type ResolvedProposal =
  | { kind: 'existing'; folderId: string; path: string; confidence: number }
  | { kind: 'new'; path: string; confidence: number }

export type ResolvedClassification = {
  proposals: ResolvedProposal[]
}

const TIMEOUT_MS = 300_000

function buildSystemPrompt(folders: FolderEntry[]): string {
  const tree = folders.map((f) => `  ${f.path}`).join('\n')
  return [
    `You are a personal archive classifier for a user named Daniel Fonnegra.`,
    `Your job: given a document, propose up to 5 ranked folders to file it under.`,
    ``,
    `Output STRICTLY a JSON object matching this schema:`,
    `{`,
    `  "proposals": [`,
    `    { "kind": "existing" | "new", "path": "<folder path>", "confidence": <0.0..1.0> },`,
    `    ...`,
    `  ]`,
    `}`,
    ``,
    `Rules:`,
    `- 1 to 5 proposals, strictly descending by confidence.`,
    `- If you are highly confident (>= 0.9) about the top pick, you MAY return only one entry.`,
    `- Otherwise return 2-5 ranked alternatives across both kinds.`,
    ``,
    `- "existing": path MUST match one of the EXISTING FOLDERS below verbatim.`,
    `- "new": path is a folder path you'd create. It can extend an existing parent`,
    `  (e.g. "/Finance/Insurance/Auto" when only "/Finance/Insurance" exists) or be`,
    `  entirely new (e.g. "/Vehicles/Registrations").`,
    ``,
    `Path rules for new folders:`,
    `- ASCII letters, digits, spaces, hyphens, underscores only in each segment.`,
    `- Each segment is at most 60 characters.`,
    `- Use Title-Case, hyphenated lowercase, or snake_case — be consistent with siblings.`,
    `- Don't propose a new folder identical to an existing one — use "existing" for that.`,
    ``,
    `- Do NOT add commentary. Output ONLY the JSON object.`,
    ``,
    `EXISTING FOLDERS:`,
    tree,
  ].join('\n')
}

type FileMeta = { basename: string; mimeType: string | null; sizeBytes: number }

function buildUserContentText(
  extracted: Extract<ExtractResult, { kind: 'text' }>,
  meta: FileMeta,
): Anthropic.MessageParam['content'] {
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

export async function classify(
  extracted: ExtractResult,
  folders: FolderEntry[],
  meta: FileMeta,
): Promise<ResolvedClassification> {
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

  const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '')
  const json = JSON.parse(raw)
  const parsed = ClassificationRawSchema.parse(json)
  parsed.proposals.sort((a, b) => b.confidence - a.confidence)

  // Resolve existing-kind paths → folderIds against the worker's cached tree.
  // If the model claimed 'existing' for a path that doesn't exist, downgrade
  // to 'new' (graceful — the server will accept and create on approve).
  const pathToId = new Map(folders.map((f) => [f.path, f.id]))
  const resolved: ResolvedProposal[] = parsed.proposals.map((p) => {
    const cleanPath = normalizePath(p.path)
    if (p.kind === 'existing') {
      const id = pathToId.get(cleanPath)
      if (id) return { kind: 'existing', folderId: id, path: cleanPath, confidence: p.confidence }
      // Model claimed existing but path isn't in the tree → treat as new.
      return { kind: 'new', path: cleanPath, confidence: p.confidence }
    }
    // Model said new — but if the path actually exists, prefer existing.
    const id = pathToId.get(cleanPath)
    if (id) return { kind: 'existing', folderId: id, path: cleanPath, confidence: p.confidence }
    return { kind: 'new', path: cleanPath, confidence: p.confidence }
  })

  return { proposals: resolved }
}

function normalizePath(p: string): string {
  // Trim, collapse internal whitespace, ensure single leading slash, no trailing slash.
  const cleaned = p.trim().replace(/\s+/g, ' ').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return cleaned.startsWith('/') ? cleaned : '/' + cleaned
}
