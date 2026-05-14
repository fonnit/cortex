// Cortex v1 — seed taxonomy v4 → Folder rows.
//
// Reads prisma/seeds/taxonomy-v4.json and synthesizes a hierarchical folder
// tree from the unique drivePath dirnames of the anchor list.
//
// Idempotent: existing seeded folders (isSeed=true) are skipped on re-seed.
// To re-seed for a different user, set CORTEX_SEED_USER_CLERK_ID before running.

import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Match lib/prisma.ts adapter selection so the seed works against both
// Neon (prod via DATABASE_URL) and a local docker Postgres.
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket
const url = process.env.DATABASE_URL ?? ''
if (!url) {
  console.error('DATABASE_URL not set. Source .env.local or .env first.')
  process.exit(1)
}
const isNeon = url.includes('neon.tech') || url.includes('.neon.') || url.includes('pooler.')
const adapter = isNeon
  ? new PrismaNeon({ connectionString: url })
  : new PrismaPg({ connectionString: url })

const prisma = new PrismaClient({ adapter })

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

async function getOwnerUserId(): Promise<string> {
  // Cortex is single-operator. The User row is created lazily when the owner
  // signs in via Clerk (lib/require-auth.ts upserts on first session). The
  // seed refuses to create a placeholder — it just attaches Folders to the
  // one existing User.
  const clerkId = process.env.CORTEX_SEED_USER_CLERK_ID
  if (clerkId) {
    const u = await prisma.user.upsert({
      where: { clerkId },
      create: { clerkId },
      update: {},
    })
    return u.id
  }

  const users = await prisma.user.findMany({ take: 2, select: { id: true, clerkId: true } })
  if (users.length === 0) {
    console.error('[seed] no User row in DB.')
    console.error('[seed] sign in to the web app once (creates your User row), then re-run the seed.')
    process.exit(1)
  }
  if (users.length > 1) {
    console.error(`[seed] found ${users.length} User rows; Cortex v1 is single-owner.`)
    console.error('[seed] resolve by setting CORTEX_SEED_USER_CLERK_ID=user_xxx to disambiguate.')
    console.error(`[seed] clerkIds: ${users.map((u) => u.clerkId).join(', ')}`)
    process.exit(1)
  }
  console.log(`[seed] attaching folders to existing User (clerkId=${users[0].clerkId})`)
  return users[0].id
}

async function main() {
  const seed = loadSeed()
  console.log(`[seed] taxonomy ${seed.version}: ${seed.anchors.length} anchors`)

  const userId = await getOwnerUserId()
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
