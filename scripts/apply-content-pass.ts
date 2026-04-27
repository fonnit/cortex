/**
 * Apply the content-pass agent's enriched anchors to extend the partial seed
 * with date-bucketed folders.
 *
 * Reads /tmp/cortex-content-pass.json (produced by the content-pass agent)
 * and inserts each anchor as an Item row with status='filed' + computed
 * sha256 hash so future re-ingest dedups onto these rows.
 */

import { statSync, createReadStream } from 'fs'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { extname, basename } from 'path'
import { prisma } from '../lib/prisma'

interface ContentAnchor {
  file: string
  drive_path: string
  type: string
  from: string | null
  context: string
  issue_date?: string
  amount?: string
  rationale?: string
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.heic': 'image/heic',
}

async function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(filePath)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

async function main() {
  const userId = process.env.SEED_USER_ID
  if (!userId) {
    console.error('SEED_USER_ID required')
    process.exit(2)
  }

  const inputPath = '/tmp/cortex-content-pass.json'
  const raw = JSON.parse(readFileSync(inputPath, 'utf8')) as {
    anchors: ContentAnchor[]
    files_inspected?: number
  }
  const anchors = raw.anchors ?? []
  console.log(`[apply-content-pass] loaded ${anchors.length} anchors from ${inputPath}`)
  console.log(`[apply-content-pass] target user_id = ${userId}`)
  console.log()

  let inserted = 0
  let updated = 0
  let skipped = 0
  const newLabels = new Set<string>()

  for (const a of anchors) {
    let st
    try {
      st = statSync(a.file)
    } catch {
      console.log(`  skip (missing): ${a.file}`)
      skipped++
      continue
    }
    if (!st.isFile()) {
      skipped++
      continue
    }
    const hash = await sha256(a.file)
    const ext = extname(a.file).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    const filename = basename(a.file)

    const existing = await prisma.item.findFirst({
      where: { user_id: userId, content_hash: hash },
    })

    if (existing) {
      await prisma.item.update({
        where: { id: existing.id },
        data: {
          status: 'filed',
          confirmed_drive_path: a.drive_path,
          proposed_drive_path: a.drive_path,
          axis_type: a.type,
          axis_from: a.from,
          axis_context: a.context,
          axis_type_confidence: 1.0,
          axis_from_confidence: a.from === null ? 0 : 1.0,
          axis_context_confidence: 1.0,
        },
      })
      updated++
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
          confirmed_drive_path: a.drive_path,
          proposed_drive_path: a.drive_path,
          axis_type: a.type,
          axis_from: a.from,
          axis_context: a.context,
          axis_type_confidence: 1.0,
          axis_from_confidence: a.from === null ? 0 : 1.0,
          axis_context_confidence: 1.0,
          classification_trace: {
            seed: {
              applied_at: new Date().toISOString(),
              source: 'content-pass-v3',
              issue_date: a.issue_date,
              amount: a.amount,
              rationale: a.rationale,
            },
          },
        },
      })
      inserted++
    }

    // Upsert TaxonomyLabel rows + bump item_count for actually-used values.
    const labelOps: Array<Promise<unknown>> = []
    const upsertLabel = (axis: string, name: string) => {
      const key = `${axis}:${name}`
      newLabels.add(key)
      return prisma.taxonomyLabel.upsert({
        where: { user_id_axis_name: { user_id: userId, axis, name } },
        create: {
          user_id: userId,
          axis,
          name,
          deprecated: false,
          item_count: 1,
          last_used: new Date(),
        },
        update: {
          item_count: { increment: 1 },
          last_used: new Date(),
          deprecated: false,
        },
      })
    }
    labelOps.push(upsertLabel('type', a.type))
    if (a.from) labelOps.push(upsertLabel('from', a.from))
    labelOps.push(upsertLabel('context', a.context))
    await Promise.all(labelOps)
  }

  console.log()
  console.log(`[apply-content-pass] inserted=${inserted} updated=${updated} skipped=${skipped}`)
  console.log(`[apply-content-pass] distinct (axis, name) labels touched: ${newLabels.size}`)

  // Folder distribution after this pass.
  const filed = await prisma.item.findMany({
    where: { user_id: userId, status: 'filed' },
    select: { confirmed_drive_path: true },
  })
  const byParent = new Map<string, number>()
  for (const i of filed) {
    if (!i.confirmed_drive_path) continue
    const parent =
      i.confirmed_drive_path.slice(0, i.confirmed_drive_path.lastIndexOf('/') + 1)
    byParent.set(parent, (byParent.get(parent) ?? 0) + 1)
  }
  const sorted = Array.from(byParent.entries()).sort((a, b) => b[1] - a[1])
  const stable = sorted.filter(([_, n]) => n >= 3).length
  console.log()
  console.log(
    `[apply-content-pass] total filed items: ${filed.length} across ${sorted.length} parent dirs`,
  )
  console.log(`[apply-content-pass] stable (≥3 anchor) parent dirs: ${stable}`)
  console.log()
  console.log('Top 25 parent dirs:')
  for (const [p, n] of sorted.slice(0, 25)) {
    const flag = n >= 3 ? '✓' : '·'
    console.log(`  ${flag}  ${n.toString().padStart(3)}  ${p}`)
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('[apply-content-pass] FATAL:', err)
  try {
    await prisma.$disconnect()
  } catch {
    /* */
  }
  process.exit(1)
})
