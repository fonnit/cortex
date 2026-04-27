/**
 * Pick N files from a corpus directory that are NOT already in the DB.
 * Used to assemble fresh smoke-test batches that don't dedupe onto seeded
 * anchor items.
 *
 * Usage: SEED_USER_ID=... node --env-file=.env.local --import tsx \
 *          scripts/pick-fresh-candidates.ts <dir> <count>
 */

import { readdirSync, statSync, createReadStream } from 'fs'
import { createHash } from 'crypto'
import { resolve } from 'path'
import { prisma } from '../lib/prisma'

async function sha(p: string): Promise<string> {
  return new Promise<string>((res) => {
    const h = createHash('sha256')
    createReadStream(p)
      .on('data', (c) => h.update(c))
      .on('end', () => res(h.digest('hex')))
  })
}

async function main() {
  const dir = resolve(process.argv[2])
  const want = parseInt(process.argv[3] ?? '10', 10)
  const userId = process.env.SEED_USER_ID

  const files = readdirSync(dir)
    .filter((f) => /\.(pdf|jpg|jpeg|png|heic)$/i.test(f))
    .map((f) => resolve(dir, f))
    .filter((p) => statSync(p).size < 1_048_576)
    .slice(0, 200) // bound

  const fresh: string[] = []
  for (const p of files) {
    const h = await sha(p)
    const existing = await prisma.item.findFirst({
      where: { user_id: userId, content_hash: h },
      select: { id: true, status: true },
    })
    if (!existing) fresh.push(p)
    if (fresh.length >= want) break
  }
  for (const p of fresh) console.log(p)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
