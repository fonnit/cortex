// Anthropic SDK + Claude Haiku classification.
//
// Input is ALWAYS text — Vision OCR runs on the Mac before classify, so we
// never send images or PDFs as multimodal blocks anymore. The prompt embeds:
//   - FILE METADATA (basename, mimeType, sizeBytes)
//   - EXTRACTED TEXT (truncated here at MAX_PROMPT_CHARS; the full text lives
//     in the worker's memory and is POSTed to the backend alongside the result
//     for RAG embedding)
//
// Output:
//   - proposals: 1-5 ranked folder candidates ({existing | new}, path-based)
//   - suggestedFilename: 1-60 chars, no extension, ASCII allowlist
//
// The worker resolves existing-kind paths → folderIds against its cached
// taxonomy after parse; the server re-validates.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { ExtractResult } from './text-extract.js'

const MODEL = process.env.CORTEX_CLASSIFY_MODEL || 'claude-haiku-4-5'
const TIMEOUT_MS = 90_000
const MAX_PROMPT_CHARS = 8000  // truncate at prompt-build only; RAG uses full text

export const FolderEntrySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  path: z.string(),
  isSeed: z.boolean(),
})
export type FolderEntry = z.infer<typeof FolderEntrySchema>

const ProposalRawSchema = z.object({
  kind: z.enum(['existing', 'new']),
  path: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

// Suggested filename: lowercase letters, digits, spaces, hyphens, underscores;
// 1-60 chars; no path separators, no extension. Server re-sanitizes.
const FilenameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9 _-]+$/)

export const ClassificationRawSchema = z.object({
  proposals: z.array(ProposalRawSchema).min(1).max(5),
  suggestedFilename: FilenameSchema,
})
export type ClassificationRaw = z.infer<typeof ClassificationRawSchema>

export type ResolvedProposal =
  | { kind: 'existing'; folderId: string; path: string; confidence: number }
  | { kind: 'new'; path: string; confidence: number }

export type ResolvedClassification = {
  proposals: ResolvedProposal[]
  suggestedFilename: string
}

function buildSystemPrompt(folders: FolderEntry[]): string {
  const tree = folders.map((f) => `  ${f.path}`).join('\n')
  return [
    `You are a personal archive classifier for a user named Daniel Fonnegra.`,
    `Given a document, you propose:`,
    `  1) up to 5 ranked folders to file it under, and`,
    `  2) a clean, descriptive filename (no extension).`,
    ``,
    `Output STRICTLY a JSON object matching this schema:`,
    `{`,
    `  "proposals": [`,
    `    { "kind": "existing" | "new", "path": "<folder path>", "confidence": <0.0..1.0> },`,
    `    ...`,
    `  ],`,
    `  "suggestedFilename": "<descriptive name, no extension>"`,
    `}`,
    ``,
    `PROPOSAL RULES:`,
    `- 1 to 5 proposals, strictly descending by confidence.`,
    `- If you are highly confident (>= 0.9) about the top pick, you MAY return only one entry.`,
    `- Otherwise return 2-5 ranked alternatives across both kinds.`,
    `- "existing": path MUST match one of the EXISTING FOLDERS below verbatim.`,
    `- "new": path is a folder path you'd create. It can extend an existing parent`,
    `  (e.g. "/Finance/Insurance/Auto" when only "/Finance/Insurance" exists) or be`,
    `  entirely new (e.g. "/Vehicles/Registrations").`,
    `- Path rules for new folders: ASCII letters, digits, spaces, hyphens, underscores`,
    `  only in each segment; each segment <= 60 chars; Title-Case, hyphenated lowercase,`,
    `  or snake_case (be consistent with siblings); don't propose a new folder identical`,
    `  to an existing one — use "existing" for that.`,
    ``,
    `FILENAME RULES:`,
    `- 1-60 characters; ASCII letters, digits, spaces, hyphens, underscores only.`,
    `- Descriptive but compact. Include key identifiers visible in the document`,
    `  (e.g. invoice number, vendor, year) when present.`,
    `- DO NOT include a file extension (no ".pdf", ".jpg", etc.).`,
    `- Prefer kebab-case for multi-word names (e.g. "passport-fonnegra-2025-renewal").`,
    `- Do NOT include the user's full name verbatim if it's clearly Daniel's own`,
    `  document (their archive — name is implicit); include only when it disambiguates`,
    `  (e.g. spouse's passport, employer name).`,
    ``,
    `- Do NOT add commentary. Output ONLY the JSON object.`,
    ``,
    `EXISTING FOLDERS:`,
    tree,
  ].join('\n')
}

type FileMeta = { basename: string; mimeType: string | null; sizeBytes: number }

function buildUserContent(
  extracted: Extract<ExtractResult, { kind: 'text' }>,
  meta: FileMeta,
): Anthropic.MessageParam['content'] {
  const truncated = extracted.content.slice(0, MAX_PROMPT_CHARS)
  return [
    {
      type: 'text',
      text:
        `FILE METADATA:\n` +
        `  filename: ${meta.basename}\n` +
        `  mimeType: ${meta.mimeType ?? 'unknown'}\n` +
        `  sizeBytes: ${meta.sizeBytes}\n` +
        `  extractionSource: ${extracted.source}\n\n` +
        `EXTRACTED TEXT (${extracted.extractedCharCount} chars total; first ${truncated.length} shown):\n${truncated}`,
    },
  ]
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
  const response = await anthropic.messages.create(
    {
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(folders),
      messages: [{ role: 'user', content: buildUserContent(extracted, meta) }],
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

  const pathToId = new Map(folders.map((f) => [f.path, f.id]))
  const resolved: ResolvedProposal[] = parsed.proposals.map((p) => {
    const cleanPath = normalizePath(p.path)
    if (p.kind === 'existing') {
      const id = pathToId.get(cleanPath)
      if (id) return { kind: 'existing', folderId: id, path: cleanPath, confidence: p.confidence }
      return { kind: 'new', path: cleanPath, confidence: p.confidence }
    }
    const id = pathToId.get(cleanPath)
    if (id) return { kind: 'existing', folderId: id, path: cleanPath, confidence: p.confidence }
    return { kind: 'new', path: cleanPath, confidence: p.confidence }
  })

  return { proposals: resolved, suggestedFilename: parsed.suggestedFilename }
}

function normalizePath(p: string): string {
  const cleaned = p.trim().replace(/\s+/g, ' ').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return cleaned.startsWith('/') ? cleaned : '/' + cleaned
}
