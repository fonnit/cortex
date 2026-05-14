// Cortex v1 — seed taxonomy v4 → Folder rows.
//
// Reads prisma/seeds/taxonomy-v4.json and synthesizes a hierarchical folder
// tree from the unique drivePath dirnames of the anchor list.
//
// Idempotent: existing seeded folders (isSeed=true) are skipped on re-seed.
// To re-seed for a different user, set CORTEX_SEED_USER_CLERK_ID before running.

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const prisma = new PrismaClient()

type Anchor = { file: string; type: string; from: string | null; drivePath: string }
type SeedDoc = { version: string; axes: Record<string, string[]>; anchors: Anchor[] }

function loadSeed(): SeedDoc {
  const p = join(process.cwd(), 'prisma/seeds/taxonomy-v4.json')
  return JSON.parse(readFileSync(p, 'utf-8')) as SeedDoc
}

function collectFolderPaths(anchors: Anchor[]): string[] {
  const set = new Set<string>()
  for (const a of anchors) {
    const parts = a.drivePath.replace(/^\/+/, '').split('/').slice(0, -1)
    while (parts.length > 0) {
      set.add('/' + parts.join('/'))
      parts.pop()
    }
  }
  return Array.from(set).sort()
}

async function ensureOwnerUser(): Promise<string> {
  // Use CORTEX_SEED_USER_CLERK_ID env if provided, else look up the only User row,
  // else create a placeholder. Sign-in will reconcile clerkId on first login.
  const clerkId = process.env.CORTEX_SEED_USER_CLERK_ID
  if (clerkId) {
    const u = await prisma.user.upsert({
      where: { clerkId },
      create: { clerkId },
      update: {},
    })
    return u.id
  }

  const existing = await prisma.user.findFirst()
  if (existing) return existing.id

  const placeholder = await prisma.user.create({
    data: { clerkId: 'seed-placeholder-' + Date.now() },
  })
  console.log(`[seed] created placeholder User ${placeholder.id} (clerkId=${placeholder.clerkId})`)
  console.log('[seed] set CORTEX_SEED_USER_CLERK_ID before next seed for the right owner')
  return placeholder.id
}

async function main() {
  const seed = loadSeed()
  console.log(`[seed] taxonomy ${seed.version}: ${seed.anchors.length} anchors`)

  const userId = await ensureOwnerUser()
  const paths = collectFolderPaths(seed.anchors)
  console.log(`[seed] ${paths.length} folder paths to ensure`)

  // Build folders in path-length order so parents exist before children
  const sorted = [...paths].sort((a, b) => a.split('/').length - b.split('/').length)

  let created = 0
  let skipped = 0

  for (const path of sorted) {
    const existing = await prisma.folder.findFirst({ where: { userId, path } })
    if (existing) {
      skipped++
      continue
    }

    const parts = path.replace(/^\/+/, '').split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : null

    let parentId: string | null = null
    if (parentPath) {
      const parent = await prisma.folder.findFirst({ where: { userId, path: parentPath } })
      if (!parent) {
        throw new Error(`Parent folder not found for ${path} (expected ${parentPath})`)
      }
      parentId = parent.id
    }

    await prisma.folder.create({
      data: { userId, parentId, name, path, isSeed: true },
    })
    created++
  }

  console.log(`[seed] folders created: ${created}, already-present: ${skipped}, total: ${created + skipped}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
