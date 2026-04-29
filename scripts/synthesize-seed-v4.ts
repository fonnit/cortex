/**
 * Seed synthesizer v4 — locks SEED-v4-prod.md decisions into a JSON artefact.
 *
 * One-shot transformer: reads cortex-seed-v2.json, applies the v2→v4 filter +
 * remap rules from SEED-v4-prod.md, and writes cortex-seed-v4.json.
 *
 * Six locked decisions implemented (see SEED-v4-prod.md):
 *   D1. Drop the `context` axis entirely from the seed (column stays in DB; v4
 *       just stops emitting any value into it).
 *   D2. Terradan layout nests under /business/ as terradan-dubai / terradan-medellin
 *       (renamed from v3's terradan-colombia).
 *   D3. type axis trimmed to exactly 22 values.
 *   D4. from axis trimmed to ~15 core + utility-providers (ostrom/empower/
 *       duesselfibre) when actually used by surviving anchors.
 *   D5. AW Realestate / PBP Trade License / Terradan Dubai License → type =
 *       corporate-registration AND drivePath under /business/terradan-dubai/corporate/.
 *   D6. Date-bucketed paths (matching /\d{4}/(\d{2}/)?) are dropped entirely.
 *
 * Inputs:  .planning/quick/260427-tlk-base-taxonomy-seed/cortex-seed-v2.json
 * Outputs: .planning/quick/260427-tlk-base-taxonomy-seed/cortex-seed-v4.json
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/synthesize-seed-v4.ts
 *
 * The transformer is deterministic: re-running it against the same v2 input
 * produces byte-identical v4 output (axes.from sorted, anchor order preserved).
 */

import { readFileSync, writeFileSync } from 'fs'
import { basename, resolve } from 'path'

/* ─────────────────────────────────────────────────────────────────────── */
/* Locked v4 axis values — copy verbatim from SEED-v4-prod.md / PLAN       */
/* ─────────────────────────────────────────────────────────────────────── */

const TYPE_V4 = [
  'bank-statement',
  'certificate',
  'civil-registry',
  'contract',
  'corporate-registration',
  'credit-application',
  'diploma',
  'employment-contract',
  'income-proof',
  'insurance-policy',
  'invoice',
  'invoice-outgoing',
  'national-id',
  'passport',
  'payslip',
  'rent-payment',
  'rental-contract',
  'residence-permit',
  'tax-filing',
  'ticket',
  'title-deed',
  'utility-bill',
] as const // 22 values

const FROM_V4_CORE = [
  'terradan',
  'fonnit',
  's-ray',
  'habyt',
  'castlabs',
  'esg-book',
  'n26',
  'wio-bank',
  'revolut',
  'germany-residence-office',
  'german-tax-authority',
  'colombia-government',
  'uae-government',
  'dubai-government',
  'accountable',
] as const // 15 values

// Utility providers — kept distinct per Decision 6
const FROM_V4_UTILITIES = ['ostrom', 'empower', 'duesselfibre'] as const

// File-name special-case for Decision 5 (AW / PBP / TerradanDubai licenses)
const CORP_REGISTRATION_SPECIAL = new Set([
  'TerradanDubai_License.pdf',
  'AW REALESTATE 2024 License .pdf',
  'PBP Trade License 2026.pdf',
])

/* ─────────────────────────────────────────────────────────────────────── */
/* Types                                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

interface V2Anchor {
  file: string
  type: string
  from: string
  context: string
  path: string
}

interface V2Seed {
  generated_at: string
  axes: { type: string[]; from: string[]; context: string[] }
  anchors: V2Anchor[]
}

interface V4Anchor {
  file: string
  type: string
  from: string | null
  drivePath: string
}

interface V4Seed {
  version: 'v4'
  generated_at: string
  source: {
    from: 'cortex-seed-v2.json'
    transformer: 'scripts/synthesize-seed-v4.ts'
    decisions: 'SEED-v4-prod.md'
  }
  axes: {
    type: string[]
    from: string[]
  }
  anchors: V4Anchor[]
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Transform                                                                */
/* ─────────────────────────────────────────────────────────────────────── */

const SEED_DIR = '.planning/quick/260427-tlk-base-taxonomy-seed'
const V2_PATH = resolve(SEED_DIR, 'cortex-seed-v2.json')
const V4_PATH = resolve(SEED_DIR, 'cortex-seed-v4.json')

const v2 = JSON.parse(readFileSync(V2_PATH, 'utf8')) as V2Seed

const typeSet = new Set<string>(TYPE_V4)
const coreFromSet = new Set<string>(FROM_V4_CORE)
const utilFromSet = new Set<string>(FROM_V4_UTILITIES)

// Date-bucket regex: a 4-digit year segment optionally followed by a 2-digit
// month segment, anywhere along the path AFTER the leading folder.
// Examples that match: /travel/2025/, /personal/finance/payslips/2025/,
//                      /business/fonnit/invoices-in/2024/12/.
const DATE_BUCKET_RE = /\/\d{4}\/(\d{2}\/)?/

let droppedDateBucketed = 0
let droppedUnknownType = 0
let fromNullified = 0
let corporateRegistrationRemapped = 0

const survivors: V4Anchor[] = []

for (const a of v2.anchors) {
  // Rule 1: Drop date-bucketed paths first.
  if (DATE_BUCKET_RE.test(a.path)) {
    droppedDateBucketed++
    continue
  }

  // Rule 2: Type filter (with AW/PBP/TerradanDubai special-case remap).
  let type = a.type
  const fname = basename(a.file)
  if (!typeSet.has(type)) {
    if (type === 'real-estate-permit' && CORP_REGISTRATION_SPECIAL.has(fname)) {
      type = 'corporate-registration'
      corporateRegistrationRemapped++
    } else {
      droppedUnknownType++
      continue
    }
  }

  // Rule 3: From filter — null out unknowns (do NOT drop the anchor).
  let from: string | null = a.from
  if (!coreFromSet.has(from) && !utilFromSet.has(from)) {
    from = null
    fromNullified++
  }

  // Rule 4: Path remaps.
  let drivePath = a.path
  drivePath = drivePath.replace('/business/terradan/dubai/', '/business/terradan-dubai/')
  drivePath = drivePath.replace('/business/terradan/colombia/', '/business/terradan-medellin/')
  drivePath = drivePath.replace('/business/terradan-colombia/', '/business/terradan-medellin/')

  // Rule 4b: corporate-registration special-case path rewrite (Decision 5).
  if (type === 'corporate-registration' && CORP_REGISTRATION_SPECIAL.has(fname)) {
    drivePath = `/business/terradan-dubai/corporate/${fname}`
  }

  // Rule 5: drop the `context` field — V4Anchor shape excludes it.
  survivors.push({ file: a.file, type, from, drivePath })
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Build axes                                                               */
/* ─────────────────────────────────────────────────────────────────────── */

// axes.type = full 22-value list (taxonomy seed inserts labels even when an
// anchor isn't present yet — empty types are legal in v4).
const axesType = [...TYPE_V4]

// axes.from = core 15 ∪ utilities actually present in surviving anchors.
const utilitiesUsed = FROM_V4_UTILITIES.filter((u) => survivors.some((s) => s.from === u))
const axesFrom = [...new Set([...FROM_V4_CORE, ...utilitiesUsed])].sort()

const v4: V4Seed = {
  version: 'v4',
  // Stable timestamp: derived from the v2 input so re-running the transformer
  // against an unchanged v2 JSON produces byte-identical v4 JSON. Required
  // by the plan's idempotency check (`git diff --exit-code` after rerun).
  generated_at: v2.generated_at,
  source: {
    from: 'cortex-seed-v2.json',
    transformer: 'scripts/synthesize-seed-v4.ts',
    decisions: 'SEED-v4-prod.md',
  },
  axes: {
    type: axesType,
    from: axesFrom,
  },
  anchors: survivors,
}

writeFileSync(V4_PATH, JSON.stringify(v4, null, 2) + '\n')

/* ─────────────────────────────────────────────────────────────────────── */
/* Summary                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

console.log(`[synthesize-seed-v4] read:  ${V2_PATH}`)
console.log(`[synthesize-seed-v4] wrote: ${V4_PATH}`)
console.log()
console.log(`Transform stats:`)
console.log(`  total_anchors_in:                 ${v2.anchors.length}`)
console.log(`  total_anchors_out:                ${survivors.length}`)
console.log(`  dropped_date_bucketed:            ${droppedDateBucketed}`)
console.log(`  dropped_unknown_type:             ${droppedUnknownType}`)
console.log(`  from_nullified:                   ${fromNullified}`)
console.log(`  corporate_registration_remapped:  ${corporateRegistrationRemapped}`)
console.log()
console.log(`Axes:`)
console.log(`  axes.type   (${axesType.length}): ${axesType.join(', ')}`)
console.log(`  axes.from   (${axesFrom.length}): ${axesFrom.join(', ')}`)
console.log()

console.log(`Anchors per parent folder:`)
const byParent = new Map<string, number>()
for (const s of survivors) {
  const parent = s.drivePath.slice(0, s.drivePath.lastIndexOf('/') + 1)
  byParent.set(parent, (byParent.get(parent) ?? 0) + 1)
}
const sortedParents = Array.from(byParent.entries()).sort((a, b) => b[1] - a[1])
for (const [p, n] of sortedParents) {
  const flag = n >= 3 ? '✓' : '✗ EMERGENT'
  console.log(`  ${flag.padEnd(11)}  ${p.padEnd(60)}  ${n} anchors`)
}
