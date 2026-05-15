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

// Taxonomy snapshot returned by /api/taxonomy. sampleFilenames keys are
// top-level folder paths (e.g. "/business"); values are the most recent
// Item.finalFilename filed anywhere under that top level. Empty {} on cold
// start — the prompt omits the RECENT FILENAMES section in that case.
export type Taxonomy = {
  folders: FolderEntry[]
  sampleFilenames: Record<string, string>
}

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

function buildSystemPrompt(taxonomy: Taxonomy): string {
  const tree = taxonomy.folders.map((f) => `  ${f.path}`).join('\n')

  const sampleEntries = Object.entries(taxonomy.sampleFilenames)
    .filter(([, fn]) => !!fn)
    .sort(([a], [b]) => a.localeCompare(b))
  const samplesBlock = sampleEntries.length === 0
    ? ''
    : [
        ``,
        `RECENT FILENAMES (one example per top-level area; mirror this style):`,
        ...sampleEntries.map(([top, fn]) => `  ${top.padEnd(14)} → ${fn}`),
      ].join('\n')

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
    `  (e.g. "/business/fonnit" when only "/business" exists) or be entirely new`,
    `  (e.g. "/vehicles/registrations").`,
    `- Path rules for new folders: lowercase-kebab only — ASCII letters, digits,`,
    `  and hyphens; words separated by single hyphens; no spaces, no underscores,`,
    `  no capitals. Each segment <= 60 chars. Don't propose a new folder identical`,
    `  to an existing one — use "existing" for that.`,
    `- Avoid folders that would plausibly hold only 1-2 documents. Prefer the next`,
    `  level up; the user will deepen the tree when volume justifies it.`,
    ``,
    `FILENAME RULES:`,
    `- 1-60 characters; lowercase-kebab — ASCII letters, digits, hyphens; words`,
    `  separated by single hyphens. No spaces, underscores, or capitals.`,
    `- Descriptive but compact. Include key identifiers visible in the document`,
    `  (e.g. invoice number, vendor, year) when present.`,
    `- DO NOT include a file extension (no ".pdf", ".jpg", etc.).`,
    `- Do NOT include the user's full name verbatim if it's clearly Daniel's own`,
    `  document (their archive — name is implicit); include it only when it`,
    `  disambiguates (e.g. spouse's passport, employer name).`,
    ``,
    `- Do NOT add commentary. Output ONLY the JSON object.`,
    ``,
    `EXISTING FOLDERS:`,
    tree,
    samplesBlock,
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
  taxonomy: Taxonomy,
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
      system: buildSystemPrompt(taxonomy),
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

  const pathToId = new Map(taxonomy.folders.map((f) => [f.path, f.id]))
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
