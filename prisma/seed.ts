// Cortex v2 — seed taxonomy v5 → Folder rows.
//
// Reads prisma/seeds/taxonomy-v5.json and creates a Folder row per path.
// Lowercase-kebab convention; the classify prompt expects the same.
//
// Idempotent: existing folders (matched by `path`) are skipped, so this is
// safe to re-run after a partial deploy.

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

type SeedDoc = { version: string; folders: string[] }

function loadSeed(): SeedDoc {
  const p = join(process.cwd(), 'prisma/seeds/taxonomy-v5.json')
  return JSON.parse(readFileSync(p, 'utf-8')) as SeedDoc
}

function expandPaths(folders: string[]): string[] {
  // Every ancestor must exist before its child. Given ["/a/b/c"], emit
  // ["/a", "/a/b", "/a/b/c"]. The v5 seed only has 1-level folders today,
  // but keeping this helper future-proofs against deeper nesting.
  const set = new Set<string>()
  for (const path of folders) {
    const parts = path.replace(/^\/+/, '').split('/')
    for (let i = 1; i <= parts.length; i++) {
      set.add('/' + parts.slice(0, i).join('/'))
    }
  }
  return Array.from(set).sort((a, b) => a.split('/').length - b.split('/').length)
}

async function main() {
  const seed = loadSeed()
  console.log(`[seed] taxonomy ${seed.version}: ${seed.folders.length} folders declared`)

  const paths = expandPaths(seed.folders)
  let created = 0
  let skipped = 0

  for (const path of paths) {
    const existing = await prisma.folder.findUnique({ where: { path } })
    if (existing) { skipped++; continue }

    const parts = path.replace(/^\/+/, '').split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : null

    let parentId: string | null = null
    if (parentPath) {
      const parent = await prisma.folder.findUnique({ where: { path: parentPath } })
      if (!parent) throw new Error(`Parent folder not found for ${path} (expected ${parentPath})`)
      parentId = parent.id
    }

    await prisma.folder.create({ data: { parentId, name, path, isSeed: true } })
    created++
  }

  console.log(`[seed] folders created: ${created}, already-present: ${skipped}, total: ${created + skipped}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
