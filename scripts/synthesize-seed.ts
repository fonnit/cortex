/**
 * Merge the 3 agent JSONs into a unified seed proposal: SEED.md (human-readable
 * for review) + cortex-seed.json (machine-readable for the apply step).
 *
 * Inputs:  /tmp/cortex-seed-documents.json
 *          /tmp/cortex-seed-downloads.json
 *          /tmp/cortex-seed-hierarchy.json
 * Outputs: .planning/quick/<TASK>/SEED.md
 *          .planning/quick/<TASK>/cortex-seed.json
 *
 * Synthesis strategy:
 *   - Dedupe axis values across docs+dls (case-insensitive). Tag each value
 *     with sources + total file evidence.
 *   - Folder structure: prefer hierarchy-agent's entity-driven model
 *     (/work/fonnit/, /work/terradan/colombia/, etc.) since that matches
 *     the user's actual subdir layout. Augment with leaf folders from docs+dls.
 *   - Sample mappings: keep all from docs+dls. Filter to mappings whose target
 *     folder appears ≥3 times (so each seeded folder is "stable" for auto-file).
 *   - Anchor items: pick the 3 highest-quality mappings per folder for the
 *     initial seed. Discard folders that don't have 3 quality mappings.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

type AxisEntry = { value: string; rationale: string; example_files?: string[] }
type Folder = { path: string; expected_files?: number; examples?: string[] }
type Mapping = {
  file: string
  type: string
  from: string
  context: string
  path: string
}

interface SeedJson {
  scope: string
  files_seen: number
  axes: { type: AxisEntry[]; from: AxisEntry[]; context: AxisEntry[] }
  folders: Folder[]
  sample_mappings: Mapping[]
}

interface HierarchyJson {
  subdir_count: number
  implied_top_level_folders: { path: string; evidence: string[]; rationale: string }[]
  implied_from_axis_values: { value: string; evidence: string[]; rationale: string }[]
  implied_context_axis_values: { value: string; evidence: string[]; rationale: string }[]
  noise_subdirs: string[]
}

const docs = JSON.parse(readFileSync('/tmp/cortex-seed-documents.json', 'utf8')) as SeedJson
const dls = JSON.parse(readFileSync('/tmp/cortex-seed-downloads.json', 'utf8')) as SeedJson
const hier = JSON.parse(readFileSync('/tmp/cortex-seed-hierarchy.json', 'utf8')) as HierarchyJson

// ── Merge axes ────────────────────────────────────────────────────────
function mergeAxis(name: 'type' | 'from' | 'context'): AxisEntry[] {
  const merged = new Map<string, { sources: string[]; rationales: string[]; examples: Set<string> }>()
  const ingest = (entries: AxisEntry[], source: string) => {
    for (const e of entries) {
      const key = e.value.toLowerCase().trim()
      if (!merged.has(key)) merged.set(key, { sources: [], rationales: [], examples: new Set() })
      const m = merged.get(key)!
      if (!m.sources.includes(source)) m.sources.push(source)
      m.rationales.push(`[${source}] ${e.rationale}`)
      for (const f of e.example_files ?? []) m.examples.add(f)
    }
  }
  ingest(docs.axes[name], 'documents')
  ingest(dls.axes[name], 'downloads')

  // Hierarchy agent only emits from + context (not type).
  if (name === 'from') {
    for (const h of hier.implied_from_axis_values) {
      const key = h.value.toLowerCase().trim()
      if (!merged.has(key)) merged.set(key, { sources: [], rationales: [], examples: new Set() })
      const m = merged.get(key)!
      if (!m.sources.includes('hierarchy')) m.sources.push('hierarchy')
      m.rationales.push(`[hierarchy] ${h.rationale}`)
    }
  }
  if (name === 'context') {
    for (const h of hier.implied_context_axis_values) {
      const key = h.value.toLowerCase().trim()
      if (!merged.has(key)) merged.set(key, { sources: [], rationales: [], examples: new Set() })
      const m = merged.get(key)!
      if (!m.sources.includes('hierarchy')) m.sources.push('hierarchy')
      m.rationales.push(`[hierarchy] ${h.rationale}`)
    }
  }

  return Array.from(merged.entries())
    .map(([value, m]) => ({
      value,
      rationale: m.rationales.join(' | '),
      example_files: Array.from(m.examples).slice(0, 4),
      sources: m.sources,
      example_count: m.examples.size,
    }))
    .sort((a, b) => {
      // Multi-source first, then by example count.
      if (a.sources.length !== b.sources.length) return b.sources.length - a.sources.length
      return b.example_count - a.example_count
    })
}

const typeAxis = mergeAxis('type')
const fromAxis = mergeAxis('from')
const contextAxis = mergeAxis('context')

// ── Merge mappings + count per folder ─────────────────────────────────
const allMappings: Mapping[] = [...docs.sample_mappings, ...dls.sample_mappings]
const folderCounts = new Map<string, Mapping[]>()
for (const m of allMappings) {
  const folder = m.path.slice(0, m.path.lastIndexOf('/') + 1) || '/'
  if (!folderCounts.has(folder)) folderCounts.set(folder, [])
  folderCounts.get(folder)!.push(m)
}

// Keep only folders with ≥3 mappings (so auto-file gate is satisfiable).
const stableFolders = Array.from(folderCounts.entries())
  .filter(([_, ms]) => ms.length >= 3)
  .sort((a, b) => b[1].length - a[1].length)

// Anchor items: top-3 mappings per stable folder.
const anchors: Mapping[] = []
for (const [_, ms] of stableFolders) {
  for (const m of ms.slice(0, 3)) anchors.push(m)
}

// Singletons / 1-2-mapping folders → flag as needing more before auto-file.
const tentativeFolders = Array.from(folderCounts.entries())
  .filter(([_, ms]) => ms.length < 3)
  .sort((a, b) => b[1].length - a[1].length)

// ── Write SEED.md ─────────────────────────────────────────────────────
function md(): string {
  const lines: string[] = []
  lines.push('# Cortex base-taxonomy seed proposal')
  lines.push('')
  lines.push(
    `**Sources:** Documents (${docs.files_seen} files), Downloads (${dls.files_seen} files), 174 subdirs analyzed.`,
  )
  lines.push('')
  lines.push(
    `**Output if approved:** ${typeAxis.length} type / ${fromAxis.length} from / ${contextAxis.length} context labels written to TaxonomyLabel; ${stableFolders.length} stable anchor folders populated with ${anchors.length} \`status='filed'\` items so the h9w auto-file gate fires on day 1.`,
  )
  lines.push('')

  lines.push('## Axes — proposed TaxonomyLabel rows')
  lines.push('')
  for (const [axis, entries] of [
    ['type', typeAxis],
    ['from', fromAxis],
    ['context', contextAxis],
  ] as const) {
    lines.push(`### \`${axis}\` axis (${entries.length} values)`)
    lines.push('')
    lines.push('| value | sources | examples | rationale (truncated) |')
    lines.push('|-------|---------|----------|----------------------|')
    for (const e of entries.slice(0, 50)) {
      const examples = (e.example_files ?? []).slice(0, 2).join(', ').slice(0, 60)
      const rat = e.rationale.slice(0, 100).replace(/\|/g, '\\|')
      lines.push(`| \`${e.value}\` | ${e.sources.join('+')} | ${examples} | ${rat} |`)
    }
    if (entries.length > 50) lines.push(`| _…+${entries.length - 50} more_ | | | |`)
    lines.push('')
  }

  lines.push('## Stable folders — anchor seeds (≥3 mapped items each)')
  lines.push('')
  lines.push(`${stableFolders.length} folders qualify for anchor seeding. Each will receive 3 \`status='filed'\` items so h9w's parent-≥3-siblings gate fires on the next matching ingestion.`)
  lines.push('')
  lines.push('| folder | mapped | anchor files |')
  lines.push('|--------|--------|--------------|')
  for (const [folder, ms] of stableFolders) {
    const examples = ms
      .slice(0, 3)
      .map((m) => m.file.split('/').pop())
      .join(', ')
      .slice(0, 90)
    lines.push(`| \`${folder}\` | ${ms.length} | ${examples} |`)
  }
  lines.push('')

  lines.push('## Tentative folders — proposed but not anchored (1–2 mapped items)')
  lines.push('')
  lines.push(`${tentativeFolders.length} folders have signal but not enough for the cold-start gate. They appear in the prompt's "Existing folders" tree (visible to Stage 2 even with 0 confirmed siblings), so Claude can still propose paths into them — items just won't auto-file until the user manually confirms 3+ items there.`)
  lines.push('')
  for (const [folder, ms] of tentativeFolders.slice(0, 30)) {
    lines.push(`- \`${folder}\` (${ms.length} mapped)`)
  }
  if (tentativeFolders.length > 30) lines.push(`- _…+${tentativeFolders.length - 30} more_`)
  lines.push('')

  lines.push('## Anchor items — first 30 of ' + anchors.length)
  lines.push('')
  lines.push('These will be inserted as `Item` rows with `status=\'filed\'` + `confirmed_drive_path` set + `axis_*` filled. They become the substrate the h9w gate counts against.')
  lines.push('')
  lines.push('| file | type | from | context | path |')
  lines.push('|------|------|------|---------|------|')
  for (const a of anchors.slice(0, 30)) {
    const f = a.file.split('/').pop()?.slice(0, 50) ?? a.file
    lines.push(`| \`${f}\` | ${a.type} | ${a.from} | ${a.context} | \`${a.path}\` |`)
  }
  if (anchors.length > 30) lines.push(`| _…+${anchors.length - 30} more_ | | | | |`)
  lines.push('')

  lines.push('## Risks + open decisions')
  lines.push('')
  lines.push(
    '1. **TaxonomyLabel-write bug (#1).** Confirming an item via `/api/triage` does not insert TaxonomyLabel rows. The seed plants the labels but future approvals won\'t grow them. Bug fix is a separate quick task.',
  )
  lines.push(
    '2. **`status=\'filed\'` requires `drive_inbox_id` (#2).** No code path sets that today. The seed sidesteps it by writing `status=\'filed\'` + `confirmed_drive_path` directly to the Item. Future items still won\'t reach `\'filed\'` until the upload step exists. Bug fix is a separate quick task.',
  )
  lines.push(
    '3. **Anchor files are local paths, not Drive paths.** `confirmed_drive_path` becomes \`/work/fonnit/invoices/...\` — virtual until Drive upload exists. The h9w gate only cares about the prefix match, so this is fine for cold-start.',
  )
  lines.push(
    '4. **Multilingual filenames.** Anchor file basenames keep the user\'s German/Spanish/English originals (e.g. `Brutto-Netto-Abrechnung 2025 08 August.pdf`). Folder names are English+lowercase per the existing convention.',
  )
  lines.push('')

  return lines.join('\n')
}

const TASK_DIR = '.planning/quick/260427-tlk-base-taxonomy-seed'
mkdirSync(resolve(TASK_DIR), { recursive: true })

writeFileSync(resolve(TASK_DIR, 'SEED.md'), md())

const machine = {
  generated_at: new Date().toISOString(),
  axes: {
    type: typeAxis,
    from: fromAxis,
    context: contextAxis,
  },
  stable_folders: stableFolders.map(([path, ms]) => ({ path, mapping_count: ms.length })),
  tentative_folders: tentativeFolders.map(([path, ms]) => ({ path, mapping_count: ms.length })),
  anchors,
}
writeFileSync(resolve(TASK_DIR, 'cortex-seed.json'), JSON.stringify(machine, null, 2))

console.log('Wrote:')
console.log(' ', resolve(TASK_DIR, 'SEED.md'))
console.log(' ', resolve(TASK_DIR, 'cortex-seed.json'))
console.log()
console.log('Summary:')
console.log('  type axis values:    ', typeAxis.length)
console.log('  from axis values:    ', fromAxis.length)
console.log('  context axis values: ', contextAxis.length)
console.log('  stable folders:      ', stableFolders.length)
console.log('  tentative folders:   ', tentativeFolders.length)
console.log('  anchor items:        ', anchors.length)
