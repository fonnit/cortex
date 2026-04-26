/**
 * Stage 1 (relevance gate) and Stage 2 (3-axis classification) prompt builders.
 *
 * Phase 7 Plan 01, Task 2. CONTEXT decisions enforced verbatim:
 *
 * D-stage1-prompt:
 *   - File items: prompt contains the absolute file path and instructs
 *     Claude to use its Read tool. NEVER includes file content.
 *   - Gmail items: prompt contains subject/from/snippet/headers from
 *     source_metadata. NEVER tries to fetch the full body.
 *   - Both: confidence ≥ 0.75 required for actionable keep/ignore.
 *
 * D-stage2-prompt:
 *   - Same item-source split (file path vs gmail metadata block).
 *   - Existing taxonomy injected as flat lists per axis.
 *   - Empty axes render as `(none yet)` so the LLM never sees a dangling label.
 *   - Confident-match threshold 0.85 in body.
 *
 * CRITICAL SECURITY CONSTRAINT
 * ----------------------------
 * These functions MUST NOT read file contents — argv stays bounded by
 * metadata sizes (T-07-02 mitigation, ACC-04 prompt-byte budget).
 * Validated by source-grep test: prompts.ts must not import any fs-style
 * module.
 */

import type { QueueItem } from '../http/types'

/** Existing taxonomy injected into Stage 2 prompts. */
export interface TaxonomyContext {
  type: string[]
  from: string[]
  context: string[]
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Stage 1                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

export function buildStage1Prompt(item: QueueItem): string {
  if (item.source === 'downloads') {
    if (!item.file_path) {
      // Defensive: an item that reaches the consumer without a file_path
      // indicates a Phase 5/6 contract violation. Fail fast so the worker
      // emits outcome:'error' instead of asking Claude to read an empty path.
      throw new Error('downloads item missing file_path')
    }
    return [
      `Classify this file: "${item.file_path}". Read the file with the Read tool to see content.`,
      '',
      'Decide: keep (relevant professional document), ignore (junk/spam/installer), or uncertain.',
      '',
      'Respond JSON only: {"decision": "keep"|"ignore"|"uncertain", "confidence": 0..1, "reason": "..."}.',
      'Confidence ≥ 0.75 required for actionable keep/ignore; else respond uncertain.',
    ].join('\n')
  }
  // gmail
  const meta = metaString(item)
  return [
    'Classify this email:',
    `Subject: ${meta.subject}`,
    `From: ${meta.from}`,
    `Preview: ${meta.snippet}`,
    `Headers: ${meta.headers}`,
    '',
    'Decide: keep / ignore / uncertain. Do not attempt to fetch the full body — judge from the metadata above.',
    'Respond JSON: {"decision":..., "confidence":..., "reason":...}.',
    'Confidence ≥ 0.75 required for actionable keep/ignore; else respond uncertain.',
  ].join('\n')
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Stage 2                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

export function buildStage2Prompt(item: QueueItem, taxonomy: TaxonomyContext): string {
  const itemBlock = buildStage2ItemBlock(item)
  // Per quick task 260426-u47 (D-auto-file, D-auto-ignore): Stage 2 emits an
  // explicit `decision` field so it can finalize an item without human triage.
  // Per quick task 260426-wgk: the closed-vocab rule has been RELAXED — Claude
  // may now propose a brand-new label name on any axis when no existing label
  // is a confident match, with confidence < 0.85 so the route's cold-start
  // guard naturally routes the item to human review (defense in depth).
  return [
    `Classify this item: ${itemBlock}.`,
    '',
    'Existing taxonomy:',
    `Type axis: ${listOrNoneYet(taxonomy.type)}`,
    `From axis: ${listOrNoneYet(taxonomy.from)}`,
    `Context axis: ${listOrNoneYet(taxonomy.context)}`,
    '',
    'Propose 3-axis labels. If an existing label from the lists above is a confident match (confidence ≥ 0.85), use it. If no existing label fits, you may propose a new label name on that axis — pick a short lowercased name (hyphen- or underscore-separated) following the style of the existing labels — but mark it with confidence below 0.85 so a human can review and approve the new label before it is added to the taxonomy. If you have no plausible label for an axis, value may be null with low confidence.',
    'Compute proposed_drive_path: e.g., "/<type>/<from>/<context>/<filename>" using your best mapping.',
    '',
    'Decide one of:',
    '- auto_file: you are confident across all 3 axes ≥ 0.85 AND every value is in the lists above (we will file the item without human review).',
    '- ignore: junk that does not deserve a label — spam, marketing emails, automated security alerts, installer files, etc. (we will mark it ignored without human review).',
    '- uncertain: anything else (a human will triage).',
    'If decision="ignore", axes may be null with low confidence — we trust the ignore signal.',
    '',
    'Respond JSON: {"axes": {"type":{"value":string|null,"confidence":0..1}, "from":{...}, "context":{...}}, "proposed_drive_path":string, "decision":"auto_file"|"ignore"|"uncertain"}.',
  ].join('\n')
}

function buildStage2ItemBlock(item: QueueItem): string {
  if (item.source === 'downloads') {
    if (!item.file_path) {
      throw new Error('downloads item missing file_path')
    }
    return `Read ${item.file_path}`
  }
  const meta = metaString(item)
  // Reuse the gmail metadata block exactly so Stage 1 + Stage 2 see the same
  // facts about the email; the LLM doesn't need to redo Stage 1's work.
  return [
    '',
    `Subject: ${meta.subject}`,
    `From: ${meta.from}`,
    `Preview: ${meta.snippet}`,
    `Headers: ${meta.headers}`,
  ].join('\n')
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

interface MetaStrings {
  subject: string
  from: string
  snippet: string
  /** JSON-stringified headers object; `{}` when missing. */
  headers: string
}

/**
 * Pull the gmail-relevant fields off `item.source_metadata`. Missing keys
 * render as `(none)` so the LLM never sees a dangling field. headers is
 * always JSON-stringified so newlines/quotes don't break the prompt shape.
 */
function metaString(item: QueueItem): MetaStrings {
  const meta = (item.source_metadata ?? {}) as Record<string, unknown>
  const subject = stringOrNone(meta['subject'])
  const from = stringOrNone(meta['from'])
  const snippet = stringOrNone(meta['snippet'])
  const headersRaw = meta['headers']
  const headers =
    headersRaw && typeof headersRaw === 'object'
      ? JSON.stringify(headersRaw)
      : '{}'
  return { subject, from, snippet, headers }
}

function stringOrNone(v: unknown): string {
  if (typeof v === 'string' && v.length > 0) return v
  return '(none)'
}

function listOrNoneYet(items: string[]): string {
  if (!items || items.length === 0) return '(none yet)'
  return items.join(', ')
}
