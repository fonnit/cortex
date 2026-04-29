/**
 * Seed applier — JSON-driven (v4).
 *
 * Loads cortex-seed-v4.json, validates it via Zod, and either:
 *   --dry-run   → statSyncs every anchor file, prints a summary + per-parent
 *                 count table, exits 0 if all files exist (1 if any missing).
 *                 NEVER opens a Prisma connection. Runs fine without
 *                 DATABASE_URL set or SEED_USER_ID set.
 *   live run    → upserts TaxonomyLabel rows for axes.type + axes.from (NOT
 *                 context — Decision 1 of SEED-v4-prod.md), and upserts Item
 *                 rows at status='filed' for every anchor whose file is on
 *                 disk. Requires SEED_USER_ID env var.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/apply-seed.ts [--dry-run] [--seed=<path>]
 *
 * Defaults:
 *   --seed=.planning/quick/260427-tlk-base-taxonomy-seed/cortex-seed-v4.json
 *
 * v4 changes vs v3:
 *   - No hardcoded axis-value arrays or anchor lists in this file. Everything
 *     loads from the JSON at runtime.
 *   - The third axis (path-redundant context grouping) is no longer written.
 *     Schema column for it stays — just left null on every Item upsert.
 *   - TaxonomyLabel rows for that third axis are not inserted.
 *   - --dry-run flag added, gated to zero-DB execution via dynamic import.
 */

import { readFileSync, statSync, createReadStream } from 'fs'
import { createHash } from 'crypto'
import { extname, basename } from 'path'
import { parseArgs } from 'node:util'
import { z } from 'zod'

/* ─────────────────────────────────────────────────────────────────────── */
/* v4 JSON schema (Zod) — strict so a stray `context` key fails fast        */
/* ─────────────────────────────────────────────────────────────────────── */

const SeedV4Schema = z.object({
  version: z.literal('v4'),
  generated_at: z.string(),
  source: z
    .object({
      from: z.string(),
      transformer: z.string(),
      decisions: z.string(),
    })
    .optional(),
  axes: z
    .object({
      type: z.array(z.string()).min(1),
      from: z.array(z.string()).min(1),
    })
    .strict(), // FAILS if `context` key is present — guards Decision 1.
  anchors: z
    .array(
      z
        .object({
          file: z.string().startsWith('/'),
          type: z.string(),
          from: z.string().nullable(),
          drivePath: z.string().startsWith('/'),
        })
        .strict(), // FAILS if anchor object has a `context` field.
    )
    .min(1),
})

type SeedV4 = z.infer<typeof SeedV4Schema>
type Anchor = SeedV4['anchors'][number]

/* ─────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                  */
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

/* ─────────────────────────────────────────────────────────────────────── */
/* CLI parsing                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

const { values: argv } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    seed: {
      type: 'string',
      default: '.planning/quick/260427-tlk-base-taxonomy-seed/cortex-seed-v4.json',
    },
  },
})

const isDryRun = argv['dry-run'] === true
const seedPath = argv.seed!

/* ─────────────────────────────────────────────────────────────────────── */
/* Load + validate seed                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

function loadSeed(path: string): SeedV4 {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    console.error(`[apply-seed] FATAL: could not read seed file at ${path}`)
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error(`[apply-seed] FATAL: seed file at ${path} is not valid JSON`)
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
  const result = SeedV4Schema.safeParse(parsed)
  if (!result.success) {
    console.error(`[apply-seed] FATAL: seed file at ${path} failed Zod validation:`)
    console.error(JSON.stringify(result.error.format(), null, 2))
    process.exit(1)
  }
  return result.data
}

function parentOf(drivePath: string): string {
  return drivePath.slice(0, drivePath.lastIndexOf('/') + 1)
}

function printParentSummary(anchors: Anchor[]): void {
  const byParent = new Map<string, number>()
  for (const a of anchors) {
    const parent = parentOf(a.drivePath)
    byParent.set(parent, (byParent.get(parent) ?? 0) + 1)
  }
  const sorted = Array.from(byParent.entries()).sort((a, b) => b[1] - a[1])
  for (const [p, n] of sorted) {
    const flag = n >= 3 ? '✓' : '✗ NEEDS MORE'
    console.log(`  ${flag.padEnd(13)}  ${p.padEnd(60)}  ${n} anchors`)
  }
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Dry-run branch — zero DB writes, zero Prisma import                      */
/* ─────────────────────────────────────────────────────────────────────── */

async function dryRun(seed: SeedV4): Promise<never> {
  console.log(`[apply-seed] DRY-RUN`)
  console.log(`[apply-seed] seed = ${seedPath}`)
  console.log(`[apply-seed] version = ${seed.version}, generated_at = ${seed.generated_at}`)
  console.log(`[apply-seed] axes.type (${seed.axes.type.length}): ${seed.axes.type.join(', ')}`)
  console.log(`[apply-seed] axes.from (${seed.axes.from.length}): ${seed.axes.from.join(', ')}`)
  console.log()

  const missing: string[] = []
  for (const a of seed.anchors) {
    try {
      const st = statSync(a.file)
      if (!st.isFile()) missing.push(`${a.file}  (not a regular file)`)
    } catch {
      missing.push(a.file)
    }
  }

  console.log(`[apply-seed] anchors total:        ${seed.anchors.length}`)
  console.log(`[apply-seed] anchors missing:      ${missing.length}`)
  if (missing.length > 0) {
    console.log(`[apply-seed] missing files:`)
    for (const m of missing) console.log(`  ✗ ${m}`)
  }

  const typesUsed = new Set(seed.anchors.map((a) => a.type))
  const fromsUsed = new Set(seed.anchors.map((a) => a.from).filter((f): f is string => f !== null))
  console.log(`[apply-seed] distinct types in anchors: ${typesUsed.size} / ${seed.axes.type.length}`)
  console.log(`[apply-seed] distinct froms in anchors: ${fromsUsed.size} / ${seed.axes.from.length}`)
  console.log()

  console.log(`[apply-seed] anchor distribution by parent folder:`)
  printParentSummary(seed.anchors)

  process.exit(missing.length === 0 ? 0 : 1)
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Live-run branch — DB writes via dynamically-imported Prisma              */
/* ─────────────────────────────────────────────────────────────────────── */

async function liveRun(seed: SeedV4): Promise<void> {
  const userId = process.env.SEED_USER_ID
  if (!userId) {
    console.error('[apply-seed] FATAL: SEED_USER_ID env var required for live run')
    console.error('[apply-seed]        (e.g. user_xxx Clerk id of the operator)')
    console.error('[apply-seed]        Use --dry-run to validate without writing.')
    process.exit(2)
  }

  // Dynamic import keeps the dry-run branch zero-DB.
  const { prisma } = await import('../lib/prisma')

  console.log(`[apply-seed] target user_id = ${userId}`)
  console.log(`[apply-seed] seed         = ${seedPath}`)
  console.log()

  // ── 1. TaxonomyLabel — upsert canonical type + from values (NOT context).
  console.log('[apply-seed] writing TaxonomyLabel rows…')
  const allLabels: { axis: string; name: string }[] = [
    ...seed.axes.type.map((v) => ({ axis: 'type', name: v })),
    ...seed.axes.from.map((v) => ({ axis: 'from', name: v })),
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

  // ── 2. Items — insert anchors at status='filed'.
  console.log('\n[apply-seed] inserting anchor Items…')
  let itemInserted = 0
  let itemSkipped = 0
  for (const a of seed.anchors) {
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
          axis_type_confidence: 1.0,
          axis_from_confidence: a.from === null ? 0 : 1.0,
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
          axis_type_confidence: 1.0,
          axis_from_confidence: a.from === null ? 0 : 1.0,
          classification_trace: {
            seed: {
              applied_at: new Date().toISOString(),
              source: 'apply-seed-v4',
              note: 'anchor item; see .planning/quick/260427-tlk-base-taxonomy-seed/SEED-v4-prod.md',
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

  // ── 3. Summary by parent folder.
  console.log('\n[apply-seed] anchor distribution by parent folder:')
  printParentSummary(seed.anchors)

  await prisma.$disconnect()
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Entry point                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

async function main() {
  const seed = loadSeed(seedPath)
  if (isDryRun) {
    await dryRun(seed)
  } else {
    await liveRun(seed)
  }
}

main().catch(async (err) => {
  console.error('[apply-seed] FATAL:', err)
  process.exit(1)
})
