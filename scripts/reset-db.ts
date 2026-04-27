/**
 * Reset Cortex runtime data — wipes Items + auto-built taxonomy artifacts so
 * the cold-start path-based auto-file gate has zero filed items and the
 * tree must rebuild from human triage.
 *
 * Preserves user setup:
 *   - IdentityProfile (company info, roles, set up via Settings)
 *   - Rule (user-defined classification rules)
 *
 * Wipes:
 *   - Item                       (every ingested file/email + classification trace)
 *   - TaxonomyLabel              (auto-built type/from/context vocabulary)
 *   - TaxonomyMergeProposal      (pending merge suggestions)
 *   - RuleConsolidationProposal  (pending rule-tree consolidation)
 *   - MetricSnapshot             (rolling counters)
 *   - GmailCursor                (historyId — next Gmail poll re-bootstraps)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/reset-db.ts
 *
 * Env: requires DATABASE_URL.
 */

import { prisma } from '../lib/prisma'

async function main(): Promise<void> {
  const tables = [
    { name: 'Item', delete: () => prisma.item.deleteMany({}) },
    { name: 'TaxonomyLabel', delete: () => prisma.taxonomyLabel.deleteMany({}) },
    { name: 'TaxonomyMergeProposal', delete: () => prisma.taxonomyMergeProposal.deleteMany({}) },
    {
      name: 'RuleConsolidationProposal',
      delete: () => prisma.ruleConsolidationProposal.deleteMany({}),
    },
    { name: 'MetricSnapshot', delete: () => prisma.metricSnapshot.deleteMany({}) },
    { name: 'GmailCursor', delete: () => prisma.gmailCursor.deleteMany({}) },
  ] as const

  console.log('[reset-db] wiping runtime tables (preserves IdentityProfile + Rule)')
  for (const t of tables) {
    const before = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${t.name}"`,
    )
    const beforeN = Number(before[0]?.count ?? 0n)
    const result = await t.delete()
    console.log(`[reset-db]   ${t.name.padEnd(28)} ${beforeN} → 0  (deleted ${result.count})`)
  }
  console.log('[reset-db] done')
}

main()
  .catch((err) => {
    console.error('[reset-db] FAILED:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
