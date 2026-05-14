// Cortex v1 — seed taxonomy v4 → Folder rows.
//
// Reads prisma/seeds/taxonomy-v4.json and synthesizes a hierarchical folder
// tree from the unique drivePath dirnames of the anchor list.
//
// Idempotent: existing folders (matched by global path) are skipped.

import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

async function main() {
  const seed = loadSeed()
  console.log(`[seed] taxonomy ${seed.version}: ${seed.anchors.length} anchors`)

  const paths = collectFolderPaths(seed.anchors)
  console.log(`[seed] ${paths.length} folder paths to ensure`)

  // Insert in path-length order so parents exist before children.
  const sorted = [...paths].sort((a, b) => a.split('/').length - b.split('/').length)

  let created = 0
  let skipped = 0

  for (const path of sorted) {
    const existing = await prisma.folder.findUnique({ where: { path } })
    if (existing) {
      skipped++
      continue
    }

    const parts = path.replace(/^\/+/, '').split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : null

    let parentId: string | null = null
    if (parentPath) {
      const parent = await prisma.folder.findUnique({ where: { path: parentPath } })
      if (!parent) {
        throw new Error(`Parent folder not found for ${path} (expected ${parentPath})`)
      }
      parentId = parent.id
    }

    await prisma.folder.create({ data: { parentId, name, path, isSeed: true } })
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
