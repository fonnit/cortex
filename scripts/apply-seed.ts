/**
 * Partial seed apply — quick task 260427-tlk.
 *
 * Inserts:
 *   - TaxonomyLabel rows for canonical type / from / context values
 *   - Item rows at status='filed' + confirmed_drive_path set, for date-agnostic
 *     folders (identity, contracts, properties, employment history, education,
 *     brand, photos) AND date-bucketed folders where the year is reliable from
 *     the filename (Steuer Erklaerung 2023.pdf, PayslipsCastlabs2021.pdf, etc.)
 *
 * Defers (content-pass needed):
 *   - /business/{entity}/invoices-in|out/{year}/{month}/
 *   - /personal/finance/invoices/{year}/{month}/
 *   - /business/{entity}/bank-statements/{year}/
 *   - /personal/finance/payslips/{employer}/{year}/  (where year not in filename)
 *
 * Each anchor uses the REAL sha256 of the local file so a future re-ingest
 * via /api/ingest dedups onto the existing row instead of creating a phantom.
 */

import { readFileSync, statSync, createReadStream } from 'fs'
import { createHash } from 'crypto'
import { extname, basename } from 'path'
import { prisma } from '../lib/prisma'

/* ─────────────────────────────────────────────────────────────────────── */
/* Canonical axis values                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

const TYPE_VALUES = [
  'invoice',
  'invoice-outgoing',
  'payslip',
  'bank-statement',
  'contract',
  'employment-contract',
  'rental-contract',
  'passport',
  'residence-permit',
  'national-id',
  'civil-registry',
  'boarding-pass',
  'hotel-booking',
  'flight-booking',
  'ticket',
  'diploma',
  'transcript',
  'apostille',
  'certificate',
  'cv-resume',
  'photo',
  'screenshot',
  'rent-payment',
  'payment-confirmation',
  'receipt',
  'title-deed',
  'real-estate-permit',
  'real-estate-license',
  'power-of-attorney',
  'tax-document',
  'tax-filing',
  'self-disclosure',
  'income-proof',
  'credit-application',
  'insurance-policy',
  'brand-asset',
  'corporate-registration',
  'diagram',
] as const

const FROM_VALUES = [
  // Employers / clients
  'fonnit',
  'habyt',
  'castlabs',
  's-ray',
  'esg-book',
  'nuvant',
  // Business entities owned by user
  'terradan',
  'terradan-colombia',
  'terradan-dubai',
  // Government / authorities
  'germany-residence-office',
  'german-tax-authority',
  'colombia-government',
  'uae-government',
  'bvfa',
  'schufa',
  // Banks
  'n26',
  'wio-bank',
  'revolut',
  // SaaS / commerce
  'amazon',
  'apple',
  'github',
  'trello',
  'upwork',
  'aws',
  'booking-com',
  'hostelworld',
  'airbnb',
  // Tax / legal services
  'accountable',
  'stb-munk',
  'elster',
  'ejari',
  // Utilities
  'ostrom',
  'duesselfibre',
  'alditalk',
  // Education
  'telc',
  // Real estate
  'seven-palm',
] as const

const CONTEXT_VALUES = [
  'personal-finance',
  'business-finance',
  'taxes',
  'work-employment',
  'work-freelance',
  'work-projects',
  'real-estate',
  'travel',
  'identity',
  'immigration',
  'family',
  'education',
  'legal',
  'media-personal',
] as const

/* ─────────────────────────────────────────────────────────────────────── */
/* Curated anchor list — file path → target Drive path + axes               */
/* ─────────────────────────────────────────────────────────────────────── */

interface Anchor {
  file: string
  drivePath: string // including filename
  type: (typeof TYPE_VALUES)[number]
  from: (typeof FROM_VALUES)[number] | null
  context: (typeof CONTEXT_VALUES)[number]
}

const ANCHORS: Anchor[] = [
  // ─── /identity/passport/ (3+) ────────────────────────────────────────
  { file: '/Users/dfonnegrag/Documents/Passport.pdf', drivePath: '/identity/passport/Passport.pdf', type: 'passport', from: 'colombia-government', context: 'identity' },
  { file: '/Users/dfonnegrag/Documents/Passport.heic', drivePath: '/identity/passport/Passport.heic', type: 'passport', from: 'colombia-government', context: 'identity' },
  { file: '/Users/dfonnegrag/Documents/Passport.jpg', drivePath: '/identity/passport/Passport.jpg', type: 'passport', from: 'colombia-government', context: 'identity' },
  { file: '/Users/dfonnegrag/Documents/Passport.png', drivePath: '/identity/passport/Passport.png', type: 'passport', from: 'colombia-government', context: 'identity' },

  // ─── /identity/residence-permit/ (3+) ───────────────────────────────
  { file: '/Users/dfonnegrag/Documents/AUFENTHALTSTITEL.pdf', drivePath: '/identity/residence-permit/AUFENTHALTSTITEL.pdf', type: 'residence-permit', from: 'germany-residence-office', context: 'identity' },
  { file: '/Users/dfonnegrag/Documents/Permanent residence letter.jpeg', drivePath: '/identity/residence-permit/Permanent residence letter.jpeg', type: 'residence-permit', from: 'germany-residence-office', context: 'identity' },
  { file: '/Users/dfonnegrag/Documents/digital_idp.pdf', drivePath: '/identity/residence-permit/digital_idp.pdf', type: 'residence-permit', from: 'germany-residence-office', context: 'identity' },

  // ─── /identity/civil-registry/ (3+, self+spouse) ─────────────────────
  { file: '/Users/dfonnegrag/Documents/REGISTRO CIVIL DANIEL 7 JUL 2025.pdf', drivePath: '/identity/civil-registry/REGISTRO CIVIL DANIEL 7 JUL 2025.pdf', type: 'civil-registry', from: 'colombia-government', context: 'identity' },
  { file: '/Users/dfonnegrag/Documents/REGISTRO CIVIL JENNY 7 JUL 2025.pdf', drivePath: '/identity/civil-registry/REGISTRO CIVIL JENNY 7 JUL 2025.pdf', type: 'civil-registry', from: 'colombia-government', context: 'identity' },
  { file: '/Users/dfonnegrag/Documents/danny passport.pdf', drivePath: '/identity/civil-registry/danny passport.pdf', type: 'civil-registry', from: 'colombia-government', context: 'identity' },

  // ─── /identity/national-ids/ (3+) ────────────────────────────────────
  // GesundheitsKarte = German health insurance card (national-id-like)
  { file: '/Users/dfonnegrag/Documents/GesundheitsKarte 1.HEIC', drivePath: '/identity/national-ids/GesundheitsKarte 1.HEIC', type: 'national-id', from: 'germany-residence-office', context: 'identity' },
  { file: '/Users/dfonnegrag/Documents/GesundheitsKarte 2.HEIC', drivePath: '/identity/national-ids/GesundheitsKarte 2.HEIC', type: 'national-id', from: 'germany-residence-office', context: 'identity' },
  { file: '/Users/dfonnegrag/Documents/Passbild.jpg', drivePath: '/identity/national-ids/Passbild.jpg', type: 'national-id', from: 'germany-residence-office', context: 'identity' },

  // ─── /family/civil-registry/ (3+, family ex-self) ────────────────────
  { file: '/Users/dfonnegrag/Documents/REGISTRO CIVIL JAIME 7 JUL 2025.pdf', drivePath: '/family/civil-registry/REGISTRO CIVIL JAIME 7 JUL 2025.pdf', type: 'civil-registry', from: 'colombia-government', context: 'family' },
  { file: '/Users/dfonnegrag/Documents/REGISTRO CIVIL ALEJANDRO 7 JUL 2025.pdf', drivePath: '/family/civil-registry/REGISTRO CIVIL ALEJANDRO 7 JUL 2025.pdf', type: 'civil-registry', from: 'colombia-government', context: 'family' },

  // ─── /education/higher-ed/ (Diplomas) (3+) ──────────────────────────
  // Note: Diploma files originally in subdirectories under Documents.
  // We use only ones we can verify exist or are safely fallback-able.
  // Skip if file doesn't exist; partial seed will just include fewer.

  // ─── /legal/powers-of-attorney/ (3+) ────────────────────────────────
  { file: '/Users/dfonnegrag/Documents/1.1. Poder Daniel Fonnegra CN.docx.pdf', drivePath: '/legal/powers-of-attorney/Poder Daniel Fonnegra CN.pdf', type: 'power-of-attorney', from: 'colombia-government', context: 'legal' },
  { file: '/Users/dfonnegrag/Documents/1.3. Poder Daniel Fonnegra CC.docx.pdf', drivePath: '/legal/powers-of-attorney/Poder Daniel Fonnegra CC.pdf', type: 'power-of-attorney', from: 'colombia-government', context: 'legal' },

  // ─── /employment/cv/ (1, will need 2 more) ──────────────────────────
  { file: '/Users/dfonnegrag/Documents/DanielFonnegraCV.pdf', drivePath: '/employment/cv/DanielFonnegraCV.pdf', type: 'cv-resume', from: null, context: 'work-employment' },

  // ─── /real-estate/primary-residence/lease/ (3+) ─────────────────────
  { file: '/Users/dfonnegrag/Documents/Daniel Fonnegra - 00061029 + Habyt contract.pdf', drivePath: '/real-estate/primary-residence/lease/Habyt contract 00061029.pdf', type: 'rental-contract', from: 'habyt', context: 'real-estate' },
  { file: '/Users/dfonnegrag/Documents/Sublet Agreement.pdf', drivePath: '/real-estate/primary-residence/lease/Sublet Agreement.pdf', type: 'rental-contract', from: null, context: 'real-estate' },

  // ─── /personal/finance/credit-applications/ (3+) ────────────────────
  { file: '/Users/dfonnegrag/Documents/Selbstauskunft.pdf', drivePath: '/personal/finance/credit-applications/Selbstauskunft.pdf', type: 'self-disclosure', from: null, context: 'personal-finance' },
  { file: '/Users/dfonnegrag/Documents/Selbstauskunft Zweckentfremdung.pdf', drivePath: '/personal/finance/credit-applications/Selbstauskunft Zweckentfremdung.pdf', type: 'self-disclosure', from: null, context: 'personal-finance' },
  { file: '/Users/dfonnegrag/Documents/Einkommens-Nachweis.pdf', drivePath: '/personal/finance/credit-applications/Einkommens-Nachweis.pdf', type: 'income-proof', from: 's-ray', context: 'personal-finance' },
  { file: '/Users/dfonnegrag/Downloads/1.Mieterselbstauskunft_Self-disclosure.pdf', drivePath: '/personal/finance/credit-applications/Mieterselbstauskunft.pdf', type: 'self-disclosure', from: null, context: 'personal-finance' },

  // ─── /personal/finance/insurance/ (3+) ──────────────────────────────
  { file: '/Users/dfonnegrag/Documents/416382638_Ihr Versicherungsvertrag_2025_01_02_4456.pdf', drivePath: '/personal/finance/insurance/Versicherungsvertrag 2025.pdf', type: 'insurance-policy', from: null, context: 'personal-finance' },

  // ─── /personal/photos/ (3+) ─────────────────────────────────────────
  { file: '/Users/dfonnegrag/Documents/IMG_0697.jpg', drivePath: '/personal/photos/IMG_0697.jpg', type: 'photo', from: null, context: 'media-personal' },
  { file: '/Users/dfonnegrag/Documents/IMG_3560.jpg', drivePath: '/personal/photos/IMG_3560.jpg', type: 'photo', from: null, context: 'media-personal' },
  { file: '/Users/dfonnegrag/Documents/IMG_4058.jpg', drivePath: '/personal/photos/IMG_4058.jpg', type: 'photo', from: null, context: 'media-personal' },
  { file: '/Users/dfonnegrag/Documents/IMG_4059.jpg', drivePath: '/personal/photos/IMG_4059.jpg', type: 'photo', from: null, context: 'media-personal' },
  { file: '/Users/dfonnegrag/Documents/IMG_8792.jpg', drivePath: '/personal/photos/IMG_8792.jpg', type: 'photo', from: null, context: 'media-personal' },

  // ─── /business/terradan/dubai/properties/seven-palm-149/ (3+) ───────
  { file: '/Users/dfonnegrag/Documents/SEVEN PALM 149 TITLE DEED.pdf', drivePath: '/business/terradan/dubai/properties/seven-palm-149/TITLE DEED.pdf', type: 'title-deed', from: 'seven-palm', context: 'real-estate' },

  // ─── /personal/finance/payslips/castlabs/2021/ (date in filename) ──
  { file: '/Users/dfonnegrag/Documents/PayslipsCastlabs2021.pdf', drivePath: '/personal/finance/payslips/castlabs/2021/PayslipsCastlabs2021.pdf', type: 'payslip', from: 'castlabs', context: 'personal-finance' },
  { file: '/Users/dfonnegrag/Documents/2021 Payslips_Income tax_PW.pdf', drivePath: '/personal/finance/payslips/castlabs/2021/Payslips_Income tax.pdf', type: 'payslip', from: 'castlabs', context: 'personal-finance' },

  // ─── /personal/finance/payslips/s-ray/2025/ (date in filename) ─────
  { file: '/Users/dfonnegrag/Documents/Brutto-Netto-Abrechnung 2025 08 August.pdf', drivePath: '/personal/finance/payslips/s-ray/2025/Brutto-Netto-Abrechnung 2025-08.pdf', type: 'payslip', from: 's-ray', context: 'personal-finance' },

  // ─── /employment/s-ray/contracts/ (1, need more) ────────────────────
  { file: '/Users/dfonnegrag/Documents/20220704_S-Ray Germany Offer Letter_Daniel Fonnegra Signed.pdf', drivePath: '/employment/s-ray/contracts/Offer Letter 2022-07.pdf', type: 'employment-contract', from: 's-ray', context: 'work-employment' },

  // ─── /legal/notarized-documents/ (will be sparse — apostilles/MSAs) ──
  { file: '/Users/dfonnegrag/Documents/(DE) MSA inkl. Datenschutz, Daniel Fonnegra, Daniel Alvarado.pdf', drivePath: '/legal/notarized-documents/MSA Daniel Alvarado.pdf', type: 'contract', from: null, context: 'legal' },

  // ─── /personal/finance/correspondence/2024/ (Mahnungen) ─────────────
  { file: '/Users/dfonnegrag/Documents/64557 - BvFA Mahnung USt 2024.pdf', drivePath: '/personal/finance/correspondence/2024/BvFA Mahnung USt 2024.pdf', type: 'tax-document', from: 'bvfa', context: 'taxes' },
  { file: '/Users/dfonnegrag/Documents/Anfrage an das Referat S 4 - Berlin.de.pdf', drivePath: '/personal/finance/correspondence/2024/Anfrage Berlin Referat S 4.pdf', type: 'tax-document', from: 'germany-residence-office', context: 'personal-finance' },

  // ─── /business/fonnit/corporate/ (3+) ────────────────────────────────
  { file: '/Users/dfonnegrag/Documents/preuve-fonnit-daniel-fonnegra-garcia-5015-1-transfer-6.pdf', drivePath: '/business/fonnit/corporate/preuve-fonnit-transfer.pdf', type: 'corporate-registration', from: 'fonnit', context: 'business-finance' },

  // ─── /education/certifications/ (1, AWS) ─────────────────────────────
  { file: '/Users/dfonnegrag/Downloads/108_3_6257541_1726240734_AWS Course Completion Certificate.pdf', drivePath: '/education/certifications/AWS Course Completion Certificate.pdf', type: 'certificate', from: 'aws', context: 'education' },

  // ─── /immigration/visa-applications/usa/ (Form W-8) ─────────────────
  { file: '/Users/dfonnegrag/Documents/Form W-8.pdf', drivePath: '/immigration/visa-applications/usa/Form W-8.pdf', type: 'tax-document', from: null, context: 'immigration' },

  // ─── /personal/health/ (Boxing fitness records) ─────────────────────
  // Note: not yet in the structure as a top-level. Skip for partial seed.

  // ─── /travel/{year}/{location}/ — only ones we can date confidently ──
  // SGArrivalCard contains "180120250828" → date 2025-01-18, location Singapore
  { file: '/Users/dfonnegrag/Documents/SGArrivalCard_180120250828.pdf', drivePath: '/travel/2025/singapore/SGArrivalCard.pdf', type: 'ticket', from: 'uae-government', context: 'travel' },
]

/* ─────────────────────────────────────────────────────────────────────── */
/* Apply                                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

async function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(filePath)
      .on('data', (chunk) => h.update(chunk))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.heic': 'image/heic',
}

async function main() {
  const userId = process.env.SEED_USER_ID
  if (!userId) {
    console.error('SEED_USER_ID env var required (e.g. user_xxx Clerk id of the operator)')
    process.exit(2)
  }

  console.log(`[apply-seed] target user_id = ${userId}`)
  console.log()

  // ── 1. TaxonomyLabel — upsert all canonical values
  console.log('[apply-seed] writing TaxonomyLabel rows…')
  const allLabels = [
    ...TYPE_VALUES.map((v) => ({ axis: 'type', name: v })),
    ...FROM_VALUES.map((v) => ({ axis: 'from', name: v })),
    ...CONTEXT_VALUES.map((v) => ({ axis: 'context', name: v })),
  ]
  let labelInserted = 0
  for (const l of allLabels) {
    const result = await prisma.taxonomyLabel.upsert({
      where: { user_id_axis_name: { user_id: userId, axis: l.axis, name: l.name } },
      create: {
        user_id: userId,
        axis: l.axis,
        name: l.name,
        deprecated: false,
        item_count: 0,
      },
      update: {},
    })
    if (result) labelInserted++
  }
  console.log(`[apply-seed]   ${labelInserted} TaxonomyLabel rows upserted`)

  // ── 2. Items — insert anchors at status='filed'
  console.log('\n[apply-seed] inserting anchor Items…')
  let itemInserted = 0
  let itemSkipped = 0
  for (const a of ANCHORS) {
    let st
    try {
      st = statSync(a.file)
    } catch {
      console.log(`  skip (missing): ${a.file}`)
      itemSkipped++
      continue
    }
    if (!st.isFile()) {
      console.log(`  skip (not file): ${a.file}`)
      itemSkipped++
      continue
    }
    const hash = await sha256(a.file)
    const ext = extname(a.file).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    const filename = basename(a.file)

    // Upsert by (user_id, content_hash) since that's the dedup key.
    const existing = await prisma.item.findFirst({
      where: { user_id: userId, content_hash: hash },
    })

    if (existing) {
      // Update in place to ensure status / drive_path / axes match seed.
      await prisma.item.update({
        where: { id: existing.id },
        data: {
          status: 'filed',
          confirmed_drive_path: a.drivePath,
          proposed_drive_path: a.drivePath,
          axis_type: a.type,
          axis_from: a.from,
          axis_context: a.context,
          axis_type_confidence: 1.0,
          axis_from_confidence: a.from === null ? 0 : 1.0,
          axis_context_confidence: 1.0,
          filename,
          mime_type: mime,
          size_bytes: st.size,
          source: 'downloads',
        },
      })
      console.log(`  upd  ${a.drivePath}`)
    } else {
      await prisma.item.create({
        data: {
          user_id: userId,
          content_hash: hash,
          source: 'downloads',
          filename,
          mime_type: mime,
          size_bytes: st.size,
          status: 'filed',
          confirmed_drive_path: a.drivePath,
          proposed_drive_path: a.drivePath,
          axis_type: a.type,
          axis_from: a.from,
          axis_context: a.context,
          axis_type_confidence: 1.0,
          axis_from_confidence: a.from === null ? 0 : 1.0,
          axis_context_confidence: 1.0,
          classification_trace: {
            seed: {
              applied_at: new Date().toISOString(),
              source: 'partial-seed-v3',
              note: 'anchor item; see .planning/quick/260427-tlk-base-taxonomy-seed/SEED-v3-architecture.md',
            },
          },
        },
      })
      console.log(`  ins  ${a.drivePath}`)
    }
    itemInserted++
  }
  console.log(
    `\n[apply-seed]   ${itemInserted} anchors inserted/updated, ${itemSkipped} skipped (missing files)`,
  )

  // ── 3. Summary by parent folder
  console.log('\n[apply-seed] anchor distribution by parent folder:')
  const byParent = new Map<string, number>()
  for (const a of ANCHORS) {
    const parent = a.drivePath.slice(0, a.drivePath.lastIndexOf('/') + 1)
    byParent.set(parent, (byParent.get(parent) ?? 0) + 1)
  }
  const sorted = Array.from(byParent.entries()).sort((a, b) => b[1] - a[1])
  for (const [p, n] of sorted) {
    const flag = n >= 3 ? '✓' : '✗ NEEDS MORE'
    console.log(`  ${flag}  ${p.padEnd(60)}  ${n} anchors`)
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('[apply-seed] FATAL:', err)
  try {
    await prisma.$disconnect()
  } catch {
    /* */
  }
  process.exit(1)
})
