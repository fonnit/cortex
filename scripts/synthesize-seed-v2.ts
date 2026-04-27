/**
 * Seed synthesizer v2 — intent-driven folder structure + deduped axes.
 *
 * Replaces v1 (which trusted the agents' folder proposals verbatim — too many
 * vendor-named folders, no temporal bucketing, axis duplicates).
 *
 * Design principles:
 *   - Folders express purpose, not content. Invoices live under the entity
 *     that owns them (FonnIT, Terradan) then by year — vendor stays in the
 *     `from` axis, searchable but never path-driving.
 *   - High-volume document types get time bucketing: invoices/{year}/,
 *     payslips/{year}/, bank-statements/{year}/, travel/{year}/.
 *   - Identity docs (passport, residence-permit) have one stable folder, no
 *     year — they're rarely added.
 *   - Entity → jurisdiction → category for businesses:
 *     /business/terradan/dubai/properties/seven-palm-149/.
 *   - Axis values: ~30 type, ~25 from, ~16 context, near-synonyms merged.
 *
 * Inputs:  /tmp/cortex-seed-{documents,downloads,hierarchy}.json
 * Outputs: .planning/quick/260427-tlk-base-taxonomy-seed/SEED-v2.md
 *          .planning/quick/260427-tlk-base-taxonomy-seed/cortex-seed-v2.json
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

type AxisEntry = { value: string; rationale: string; example_files?: string[] }
type Mapping = { file: string; type: string; from: string; context: string; path: string }
interface SeedJson {
  files_seen: number
  axes: { type: AxisEntry[]; from: AxisEntry[]; context: AxisEntry[] }
  sample_mappings: Mapping[]
}

const docs = JSON.parse(readFileSync('/tmp/cortex-seed-documents.json', 'utf8')) as SeedJson
const dls = JSON.parse(readFileSync('/tmp/cortex-seed-downloads.json', 'utf8')) as SeedJson

/* ─────────────────────────────────────────────────────────────────────── */
/* Axis canon — one canonical value per concept; merge near-synonyms        */
/* ─────────────────────────────────────────────────────────────────────── */

/** Lowercase value → canonical name. Anything not listed is dropped. */
const TYPE_CANON: Record<string, string> = {
  invoice: 'invoice',
  'outgoing-invoice': 'invoice-outgoing',
  payslip: 'payslip',
  'bank-statement': 'bank-statement',
  contract: 'contract',
  'employment-contract': 'employment-contract',
  'rental-contract': 'rental-contract',
  passport: 'passport',
  'residence-permit': 'residence-permit',
  'national-id': 'national-id',
  'id-document': 'national-id',
  'civil-registry': 'civil-registry',
  'boarding-pass': 'boarding-pass',
  'hotel-booking': 'hotel-booking',
  'flight-booking': 'flight-booking',
  ticket: 'ticket',
  'trip-itinerary': 'ticket',
  diploma: 'diploma',
  certificate: 'certificate',
  'cv-resume': 'cv-resume',
  photo: 'photo',
  screenshot: 'screenshot',
  'rent-receipt': 'rent-payment',
  'rent-payment': 'rent-payment',
  'payment-confirmation': 'payment-confirmation',
  receipt: 'receipt',
  'expense-receipt': 'receipt',
  'title-deed': 'title-deed',
  'real-estate-permit': 'real-estate-permit',
  'power-of-attorney': 'power-of-attorney',
  'tax-document': 'tax-document',
  'self-disclosure-form': 'self-disclosure',
  'income-proof': 'income-proof',
  'insurance-policy': 'insurance-policy',
  'logo-asset': 'brand-asset',
  apostille: 'apostille',
  'credit-application': 'credit-application',
  diagram: 'diagram',
  installer: 'installer',
  misc: 'misc',
}

const FROM_CANON: Record<string, string> = {
  // Employers / clients
  fonnit: 'fonnit',
  habyt: 'habyt',
  castlabs: 'castlabs',
  's-ray': 's-ray',
  esgbook: 'esg-book',
  'esg-book': 'esg-book',
  nuvant: 'nuvant',
  // Business entities
  terradan: 'terradan',
  'terradan-colombia': 'terradan-colombia',
  'terradan-dubai': 'terradan-dubai',
  // Government / authorities
  'germany-residence-office': 'germany-residence-office',
  'german-tax-authority': 'german-tax-authority',
  'colombia-government': 'colombia-government',
  'uae-government': 'uae-government',
  'dubai-det': 'uae-government',
  bvfa: 'bvfa',
  schufa: 'schufa',
  // Banks
  n26: 'n26',
  'wio-bank': 'wio-bank',
  revolut: 'revolut',
  // SaaS / commerce
  amazon: 'amazon',
  apple: 'apple',
  github: 'github',
  trello: 'trello',
  upwork: 'upwork',
  'booking-com': 'booking-com',
  hostelworld: 'hostelworld',
  airbnb: 'airbnb',
  // Tax / legal
  accountable: 'accountable',
  'stb-munk': 'stb-munk',
  elster: 'elster',
  ejari: 'ejari',
  // Utilities
  ostrom: 'ostrom',
  duesselfibre: 'duesselfibre',
  alditalk: 'alditalk',
  // Education
  telc: 'telc',
  // Real estate
  'seven-palm': 'seven-palm',
  // Apps (treat as `from` for content origin)
  zoom: 'zoom',
  chatgpt: 'chatgpt',
  whatsapp: 'whatsapp',
}

const CONTEXT_CANON: Record<string, string> = {
  'personal-finance': 'personal-finance',
  finance: 'personal-finance',
  'business-finance': 'business-finance',
  taxes: 'taxes',
  'work-employment': 'work-employment',
  'work-freelance': 'work-freelance',
  'work-projects': 'work-projects',
  'real-estate': 'real-estate',
  travel: 'travel',
  identity: 'identity',
  immigration: 'immigration',
  family: 'family',
  education: 'education',
  housing: 'real-estate',
  'housing-rental': 'real-estate',
  'company-ops': 'business-finance',
  shopping: 'shopping',
  'media-personal': 'media-personal',
  'personal-photos': 'media-personal',
  'tools-software': 'tools',
  'vehicle-licensing': 'identity',
  legal: 'legal',
  // Drop these — too narrow / not useful
  // 'invoices', 'gis-mapping', 'gaming', 'meetings', 'language-learning',
  // 'fonts-assets', 'design-references'
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Path repathing — apply intent rules to each anchor                       */
/* ─────────────────────────────────────────────────────────────────────── */

const YEAR_RX = /\b(20[12]\d)\b/ // 2010-2029
const MONTH_NAME_RX = /\b(jan|feb|m[äa]r|apr|mai|may|jun|jul|aug|sep|o[ck]t|nov|de[cz])/i
const SEVEN_PALM_RX = /seven.?palm.?(\d+)|sp[ -]?(\d{3})|palm.{0,5}(\d{3})/i

function extractYear(filename: string, dir: string): string {
  const fromName = filename.match(YEAR_RX)?.[1]
  if (fromName) return fromName
  const fromDir = dir.match(YEAR_RX)?.[1]
  if (fromDir) return fromDir
  return '2025'
}

function repath(m: Mapping): { path: string; type: string; from: string; context: string } | null {
  const filename = m.file.split('/').pop()!
  const dir = m.file.split('/').slice(0, -1).join('/')
  const year = extractYear(filename, dir)

  const t = TYPE_CANON[m.type.toLowerCase()] ?? null
  const f = FROM_CANON[m.from.toLowerCase()] ?? 'misc'
  const c = CONTEXT_CANON[m.context.toLowerCase()] ?? null

  // Drop mappings whose type or context is not in our canonical set.
  if (!t || !c) return null

  // ─── INVOICES (entity-bucketed, year-bucketed) ────────────────────────
  if (t === 'invoice') {
    const isFonnit = /steuererklaerung|fonnit|steuern/i.test(dir) || /Rechnung_/i.test(filename)
    const isTerradanCol = /terradan.*colombia/i.test(dir)
    const isTerradanDub = /terradan.*dubai/i.test(dir) || /seven.?palm/i.test(filename)
    if (isTerradanDub) return out(`/business/terradan/dubai/invoices-in/${year}/`, t, f, 'business-finance')
    if (isTerradanCol) return out(`/business/terradan/colombia/invoices-in/${year}/`, t, f, 'business-finance')
    if (isFonnit) return out(`/business/fonnit/invoices-in/${year}/`, t, f, 'business-finance')
    // Default for any unclassified invoice → FonnIT, the dominant business
    return out(`/business/fonnit/invoices-in/${year}/`, t, f, 'business-finance')
  }
  if (t === 'invoice-outgoing') {
    if (/terradan/i.test(dir)) return out(`/business/terradan/invoices-out/${year}/`, t, f, 'business-finance')
    return out(`/business/fonnit/invoices-out/${year}/`, t, f, 'business-finance')
  }

  // ─── PAYSLIPS / BANK / FINANCE (year-bucketed) ────────────────────────
  if (t === 'payslip') return out(`/personal/finance/payslips/${year}/`, t, f, 'personal-finance')
  if (t === 'bank-statement') {
    if (/businesskonto|fonnit/i.test(filename)) {
      return out(`/business/fonnit/bank-statements/${year}/`, t, f, 'business-finance')
    }
    return out(`/personal/finance/bank-statements/${year}/`, t, f, 'personal-finance')
  }

  // ─── TRAVEL (year-bucketed, all sub-types co-located) ─────────────────
  if (['boarding-pass', 'flight-booking', 'hotel-booking', 'ticket'].includes(t)) {
    return out(`/travel/${year}/`, t, f, 'travel')
  }

  // ─── IDENTITY (single stable folders, no year) ────────────────────────
  if (t === 'passport') return out(`/identity/passport/`, t, f, 'identity')
  if (t === 'residence-permit') return out(`/identity/residence-permit/`, t, f, 'identity')
  if (t === 'national-id') return out(`/identity/national-ids/`, t, f, 'identity')
  if (t === 'civil-registry') {
    // Self+spouse → identity. Other family → family.
    if (/DANIEL|JENNY/i.test(filename)) return out(`/identity/civil-registry/`, t, f, 'identity')
    return out(`/family/civil-registry/`, t, f, 'family')
  }

  // ─── REAL ESTATE — properties (Seven Palm), rentals ───────────────────
  if (t === 'title-deed' || t === 'real-estate-permit') {
    const palm = filename.match(SEVEN_PALM_RX) || dir.match(SEVEN_PALM_RX)
    if (palm) {
      const num = palm[1] ?? palm[2] ?? palm[3]
      return out(`/business/terradan/dubai/properties/seven-palm-${num}/`, t, f, 'real-estate')
    }
    return out(`/real-estate/property-deeds/`, t, f, 'real-estate')
  }
  if (t === 'rental-contract') return out(`/real-estate/rental/contracts/`, t, f, 'real-estate')
  if (t === 'rent-payment') return out(`/real-estate/rental/${year}/`, t, f, 'real-estate')

  // ─── CONTRACTS (employer-bucketed for employment, otherwise legal) ────
  if (t === 'employment-contract') {
    const employer = ['s-ray', 'habyt', 'castlabs', 'esg-book'].find((e) => f === e) ?? 'other'
    return out(`/work/employment/${employer}/contracts/`, t, f, 'work-employment')
  }
  if (t === 'contract') {
    if (/mietvertrag|sublet|rental/i.test(filename)) return out(`/real-estate/rental/contracts/`, t, f, 'real-estate')
    if (/MSA|master.service|datenschutz/i.test(filename)) return out(`/legal/contracts/`, t, f, 'legal')
    return out(`/legal/contracts/`, t, f, 'legal')
  }

  // ─── WORK ─────────────────────────────────────────────────────────────
  if (t === 'cv-resume') return out(`/work/cv/`, t, f, 'work-employment')
  if (t === 'diploma') return out(`/education/diplomas/`, t, f, 'education')
  if (t === 'certificate') return out(`/education/certificates/`, t, f, 'education')

  // ─── PERSONAL FINANCE leaves ──────────────────────────────────────────
  if (t === 'receipt' || t === 'payment-confirmation') {
    return out(`/personal/finance/receipts/${year}/`, t, f, 'personal-finance')
  }
  if (t === 'self-disclosure' || t === 'income-proof' || t === 'credit-application') {
    return out(`/personal/finance/credit-applications/`, t, f, 'personal-finance')
  }
  if (t === 'insurance-policy') return out(`/personal/finance/insurance/`, t, f, 'personal-finance')

  // ─── TAXES ────────────────────────────────────────────────────────────
  if (t === 'tax-document') {
    if (/fonnit|FONN/i.test(filename)) return out(`/business/fonnit/taxes/${year}/`, t, f, 'taxes')
    return out(`/personal/taxes/${year}/`, t, f, 'taxes')
  }

  // ─── LEGAL ────────────────────────────────────────────────────────────
  if (t === 'power-of-attorney') return out(`/legal/power-of-attorney/`, t, f, 'legal')
  if (t === 'apostille') return out(`/education/apostilles/`, t, f, 'education')

  // ─── PHOTOS / SCREENSHOTS / BRAND / TOOLS ─────────────────────────────
  if (t === 'photo') return out(`/personal/photos/`, t, f, 'media-personal')
  if (t === 'screenshot') return out(`/personal/screenshots/`, t, f, 'media-personal')
  if (t === 'brand-asset') return out(`/business/fonnit/branding/`, t, f, 'business-finance')
  if (t === 'diagram') return out(`/tools/diagrams/`, t, f, 'tools')
  if (t === 'installer') return out(`/tools/installers/`, t, f, 'tools')

  return out(`/misc/`, t, f, c)
}

function out(folder: string, type: string, from: string, context: string): { path: string; type: string; from: string; context: string } {
  return { path: folder, type, from, context }
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Apply: re-path every mapping, group by folder, keep ≥3-anchor folders    */
/* ─────────────────────────────────────────────────────────────────────── */

const allMappings = [...docs.sample_mappings, ...dls.sample_mappings]
const repathed: Array<{ original: Mapping; repathed: ReturnType<typeof repath> }> = []
for (const m of allMappings) {
  const r = repath(m)
  if (r) repathed.push({ original: m, repathed: r })
}

// Group by canonical folder.
const byFolder = new Map<string, typeof repathed>()
for (const r of repathed) {
  const folder = r.repathed!.path
  if (!byFolder.has(folder)) byFolder.set(folder, [])
  byFolder.get(folder)!.push(r)
}

// Stable folders (≥3) and tentative (1–2).
const stable = Array.from(byFolder.entries()).filter(([, ms]) => ms.length >= 3).sort((a, b) => b[1].length - a[1].length)
const tentative = Array.from(byFolder.entries()).filter(([, ms]) => ms.length < 3).sort((a, b) => b[1].length - a[1].length)

// Anchors: top 3 per stable folder.
const anchors = stable.flatMap(([, ms]) => ms.slice(0, 3))

// Axis lists — only values actually used in our anchors (drop dead canon entries).
const usedTypes = new Set<string>()
const usedFroms = new Set<string>()
const usedContexts = new Set<string>()
for (const r of repathed) {
  usedTypes.add(r.repathed!.type)
  usedFroms.add(r.repathed!.from)
  usedContexts.add(r.repathed!.context)
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Render SEED-v2.md                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

function md(): string {
  const L: string[] = []
  L.push('# Cortex base-taxonomy seed proposal — v2 (intent-driven)')
  L.push('')
  L.push(`**Sources:** Documents (${docs.files_seen} files), Downloads (${dls.files_seen} files).`)
  L.push('')
  L.push('## Design principles')
  L.push('')
  L.push('1. **Folders express purpose, not content.** Invoices live under the entity (FonnIT, Terradan-CO, Terradan-Dubai) that files them on taxes, then by year. Vendor stays in the `from` axis only — searchable but never path-driving.')
  L.push('2. **Time bucketing for high-volume types**: invoices, payslips, bank statements, rent payments, travel.')
  L.push('3. **Stable singleton folders** for low-volume / high-importance docs (passport, residence-permit, diplomas) — no year subfolder.')
  L.push('4. **Entity → jurisdiction → category** for businesses: `/business/terradan/dubai/properties/seven-palm-149/`.')
  L.push('5. **Self+spouse vs other family**: civil-registry rows for Daniel+Jenny → `/identity/civil-registry/`. For Jaime, Alejandro, Medellín ancestors → `/family/civil-registry/`.')
  L.push('6. **Multi-jurisdiction identity**: passport / residence-permit / national-id / civil-registry are separate folders — they\'re used in different contexts.')
  L.push('')
  L.push(`**Output if approved:** ${usedTypes.size} type / ${usedFroms.size} from / ${usedContexts.size} context labels written to TaxonomyLabel; ${stable.length} stable folders populated with ${anchors.length} \`status='filed'\` items so the h9w auto-file gate fires on day 1.`)
  L.push('')

  L.push('## Stable folders — anchor seeds')
  L.push('')
  L.push('| folder | mapped | examples |')
  L.push('|--------|--------|----------|')
  for (const [folder, ms] of stable) {
    const ex = ms.slice(0, 3).map((r) => r.original.file.split('/').pop()).join(', ').slice(0, 80)
    L.push(`| \`${folder}\` | ${ms.length} | ${ex} |`)
  }
  L.push('')

  L.push('## Tentative folders (1–2 mapped)')
  L.push('')
  L.push('Visible to Stage 2 prompt but won\'t auto-file until 3+ items confirmed.')
  L.push('')
  for (const [folder, ms] of tentative) L.push(`- \`${folder}\` (${ms.length} mapped)`)
  L.push('')

  L.push('## Axes')
  L.push('')
  L.push(`### \`type\` (${usedTypes.size} values)`)
  L.push('')
  L.push(Array.from(usedTypes).sort().map((v) => `\`${v}\``).join(' · '))
  L.push('')
  L.push(`### \`from\` (${usedFroms.size} values)`)
  L.push('')
  L.push(Array.from(usedFroms).sort().map((v) => `\`${v}\``).join(' · '))
  L.push('')
  L.push(`### \`context\` (${usedContexts.size} values)`)
  L.push('')
  L.push(Array.from(usedContexts).sort().map((v) => `\`${v}\``).join(' · '))
  L.push('')

  L.push('## Sample anchor items (first 30 of ' + anchors.length + ')')
  L.push('')
  L.push('| file | type | from | context | path |')
  L.push('|------|------|------|---------|------|')
  for (const a of anchors.slice(0, 30)) {
    const f = a.original.file.split('/').pop()?.slice(0, 50) ?? ''
    L.push(`| \`${f}\` | ${a.repathed!.type} | ${a.repathed!.from} | ${a.repathed!.context} | \`${a.repathed!.path}\` |`)
  }
  if (anchors.length > 30) L.push(`| _…+${anchors.length - 30} more_ | | | | |`)
  L.push('')

  L.push('## What\'s deliberately NOT seeded')
  L.push('')
  L.push('- Singleton anchor types with 1–2 examples — they live as tentative folders so Claude\'s prompt sees them, but they don\'t get the 3-item auto-file boost yet.')
  L.push('- Vendor-named folders. Apple, Trello, GitHub, Amazon are `from` axis values for search; their invoices/receipts file under the entity that pays for them, by year.')
  L.push('- Personal photos beyond the IMG_* cluster. The 30+ family photos under `~/Documents/IMG_*.jpg` go under `/personal/photos/` as a single anchor folder, not subdivided.')
  L.push('- Software project subdirectories (`apikit/`, `fastrader/`, `esgbook-test/`). Their git/build artifacts shouldn\'t get filed; their meaningful docs (proposals, diagrams) get repathed elsewhere.')
  L.push('')

  return L.join('\n')
}

const TASK_DIR = '.planning/quick/260427-tlk-base-taxonomy-seed'
writeFileSync(resolve(TASK_DIR, 'SEED-v2.md'), md())

const machine = {
  generated_at: new Date().toISOString(),
  axes: {
    type: Array.from(usedTypes).sort(),
    from: Array.from(usedFroms).sort(),
    context: Array.from(usedContexts).sort(),
  },
  stable_folders: stable.map(([path, ms]) => ({ path, mapping_count: ms.length })),
  tentative_folders: tentative.map(([path, ms]) => ({ path, mapping_count: ms.length })),
  anchors: anchors.map((a) => ({
    file: a.original.file,
    type: a.repathed!.type,
    from: a.repathed!.from,
    context: a.repathed!.context,
    path: a.repathed!.path + a.original.file.split('/').pop(),
  })),
}
writeFileSync(resolve(TASK_DIR, 'cortex-seed-v2.json'), JSON.stringify(machine, null, 2))

console.log('Wrote:')
console.log(' ', resolve(TASK_DIR, 'SEED-v2.md'))
console.log(' ', resolve(TASK_DIR, 'cortex-seed-v2.json'))
console.log()
console.log('Summary:')
console.log('  type values:       ', usedTypes.size)
console.log('  from values:       ', usedFroms.size)
console.log('  context values:    ', usedContexts.size)
console.log('  stable folders:    ', stable.length)
console.log('  tentative folders: ', tentative.length)
console.log('  anchor items:      ', anchors.length)
console.log('  dropped (no canon):', allMappings.length - repathed.length)
