// One-shot migration: collapse the seed-time placeholder User into the real
// Clerk-authenticated User. Run this once after Daniel has signed in to the
// web app (which creates the real User row).
//
// What it does:
//   1. Finds Users with clerkId LIKE 'seed-placeholder-%' (the seed-time row).
//   2. Finds the real User (any other row with clerkId LIKE 'user_%').
//   3. Reassigns every Folder, Item, Decision from placeholder → real.
//   4. Deletes the placeholder User.
//
// Refuses to run if:
//   - There's no placeholder (nothing to do).
//   - There's no real User (Daniel hasn't signed in yet).
//   - There are multiple real Users (ambiguous — bail with the list).
//
// Usage:
//   set -a; source .env.local; set +a; npx tsx scripts/migrate-placeholder.ts

import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket
const url = process.env.DATABASE_URL ?? ''
if (!url) {
  console.error('DATABASE_URL not set. Source .env.local first.')
  process.exit(1)
}
const isNeon = url.includes('neon.tech') || url.includes('.neon.') || url.includes('pooler.')
const adapter = isNeon
  ? new PrismaNeon({ connectionString: url })
  : new PrismaPg({ connectionString: url })

const prisma = new PrismaClient({ adapter })

async function main() {
  const placeholders = await prisma.user.findMany({
    where: { clerkId: { startsWith: 'seed-placeholder-' } },
    select: { id: true, clerkId: true },
  })

  if (placeholders.length === 0) {
    console.log('[migrate] no placeholder User found — nothing to do.')
    return
  }

  if (placeholders.length > 1) {
    console.error(`[migrate] found ${placeholders.length} placeholder users; bailing for safety.`)
    console.error('[migrate] clerkIds:', placeholders.map((p) => p.clerkId).join(', '))
    process.exit(1)
  }

  const real = await prisma.user.findMany({
    where: { clerkId: { startsWith: 'user_' } },
    select: { id: true, clerkId: true },
  })

  if (real.length === 0) {
    console.error('[migrate] no real User found (no clerkId starting with user_).')
    console.error('[migrate] sign in to the web app once, then re-run.')
    process.exit(1)
  }

  if (real.length > 1) {
    console.error(`[migrate] found ${real.length} real Users; ambiguous.`)
    console.error('[migrate] clerkIds:', real.map((u) => u.clerkId).join(', '))
    process.exit(1)
  }

  const placeholder = placeholders[0]
  const owner = real[0]
  console.log(`[migrate] placeholder=${placeholder.clerkId} (id=${placeholder.id})`)
  console.log(`[migrate] real owner=${owner.clerkId} (id=${owner.id})`)

  // Counts before
  const [folders, items, decisions] = await Promise.all([
    prisma.folder.count({ where: { userId: placeholder.id } }),
    prisma.item.count({ where: { userId: placeholder.id } }),
    prisma.decision.count({ where: { userId: placeholder.id } }),
  ])
  console.log(`[migrate] placeholder owns: folders=${folders} items=${items} decisions=${decisions}`)

  if (folders === 0 && items === 0 && decisions === 0) {
    console.log('[migrate] placeholder is empty — just deleting it.')
    await prisma.user.delete({ where: { id: placeholder.id } })
    console.log('[migrate] done.')
    return
  }

  await prisma.$transaction([
    prisma.folder.updateMany({
      where: { userId: placeholder.id },
      data: { userId: owner.id },
    }),
    prisma.item.updateMany({
      where: { userId: placeholder.id },
      data: { userId: owner.id },
    }),
    prisma.decision.updateMany({
      where: { userId: placeholder.id },
      data: { userId: owner.id },
    }),
    prisma.user.delete({ where: { id: placeholder.id } }),
  ])

  // Counts after
  const [folders2, items2, decisions2] = await Promise.all([
    prisma.folder.count({ where: { userId: owner.id } }),
    prisma.item.count({ where: { userId: owner.id } }),
    prisma.decision.count({ where: { userId: owner.id } }),
  ])
  console.log(`[migrate] owner now has: folders=${folders2} items=${items2} decisions=${decisions2}`)
  console.log('[migrate] done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
