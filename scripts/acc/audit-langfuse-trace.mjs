#!/usr/bin/env node
// scripts/acc/audit-langfuse-trace.mjs — Phase 8 Plan 01 Task 2
//
// ACC-05: reconstruct the end-to-end span chain in Langfuse for a single
// item. Walks: api-ingest → api-queue → consumer-stage{1|2}-item → api-classify.
//
// Usage:
//   node scripts/acc/audit-langfuse-trace.mjs --item-id ITEM_ID
//   node scripts/acc/audit-langfuse-trace.mjs --content-hash HASH
//   node scripts/acc/audit-langfuse-trace.mjs --require-stage2 --item-id ID
//   node scripts/acc/audit-langfuse-trace.mjs --dry-run
//
// Retries the trace fetch up to 12 × 5s = 60s for Langfuse eventual
// consistency (CONTEXT D-06). Pure HTTP via the Langfuse SDK; no DB.

import { walkSpanChain, REQUIRED_SPAN_NAMES } from './lib/trace-walker.mjs'

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  printHelp()
  process.exit(0)
}
if (args.dryRun) {
  console.log('[DRY-RUN] Would fetch traces from Langfuse and walk the span chain.')
  console.log(
    '[DRY-RUN] Required spans:',
    Object.values(REQUIRED_SPAN_NAMES).join(', '),
  )
  console.log('[DRY-RUN] Match key:', args.itemId ? 'item_id' : args.contentHash ? 'content_hash' : '(none — pass --item-id or --content-hash)')
  console.log('[DRY-RUN] Retry policy: 12 attempts x 5s backoff (60s total)')
  console.log('[DRY-RUN] OK')
  process.exit(0)
}
if (!args.itemId && !args.contentHash) {
  console.error(
    'FAIL: must pass --item-id ID or --content-hash HASH (or --dry-run / --help)',
  )
  process.exit(2)
}

// Lazy-import the Langfuse SDK so --dry-run / --help don't require the
// dependency to be installed (and so unit tests of trace-walker.mjs never
// pull in network code).
const { Langfuse } = await import('langfuse')

const publicKey = mustEnv('LANGFUSE_PUBLIC_KEY')
const secretKey = mustEnv('LANGFUSE_SECRET_KEY')
const baseUrl = process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com'
const lf = new Langfuse({ publicKey, secretKey, baseUrl })

const matchKey = args.itemId ? 'item_id' : 'content_hash'
const matchVal = args.itemId ?? args.contentHash

const RETRY_MAX = 12
const RETRY_DELAY_MS = 5000
let result = null
for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
  let traces = []
  try {
    traces = await fetchRecentMatchingTraces(lf, matchKey, matchVal)
  } catch (err) {
    console.error(`Attempt ${attempt}/${RETRY_MAX}: fetch error: ${err?.message ?? err}`)
  }
  result = walkSpanChain(traces, { requireStage2: !!args.requireStage2 })
  if (result.ok) break
  if (attempt < RETRY_MAX) {
    const missing = result.missing.join(',') || '-'
    const broken = result.broken.join(',') || '-'
    console.error(
      `Attempt ${attempt}/${RETRY_MAX}: missing=${missing} broken=${broken}; retrying in ${RETRY_DELAY_MS / 1000}s …`,
    )
    await sleep(RETRY_DELAY_MS)
  }
}

await lf.flushAsync().catch(() => {})

if (result?.ok) {
  console.log(
    `PASS ACC-05 (langfuse-trace) — chain: ${result.chain.join(' → ')}`,
  )
  process.exit(0)
}
console.error('FAIL ACC-05 (langfuse-trace):')
console.error('  missing spans:', result?.missing?.join(', ') || '-')
console.error('  broken links:', result?.broken?.join(', ') || '-')
process.exit(1)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help') out.help = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--require-stage2') out.requireStage2 = true
    else if (a === '--item-id') out.itemId = argv[++i]
    else if (a === '--content-hash') out.contentHash = argv[++i]
  }
  return out
}

function printHelp() {
  console.log(
    'Usage: audit-langfuse-trace.mjs [--item-id ID | --content-hash HASH] [--require-stage2] [--dry-run | --help]',
  )
  console.log('')
  console.log(
    `Required spans: ${Object.values(REQUIRED_SPAN_NAMES).join(', ')}`,
  )
  console.log('')
  console.log('Env vars (live mode only):')
  console.log('  LANGFUSE_PUBLIC_KEY (required)')
  console.log('  LANGFUSE_SECRET_KEY (required)')
  console.log('  LANGFUSE_HOST       (optional, defaults to https://cloud.langfuse.com)')
}

function mustEnv(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`FAIL: missing env ${name}`)
    process.exit(2)
  }
  return v
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchRecentMatchingTraces(lf, matchKey, matchVal) {
  // List recent traces (last 1h) and filter by metadata / input match.
  // The Langfuse public API exposes traceList (singular) — see the SDK
  // type definition for ApiTraceListParams.
  const fromTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const resp = await lf.api.traceList({ fromTimestamp, limit: 100 })
  const candidates = resp?.data ?? []
  const matching = []
  for (const summary of candidates) {
    try {
      const full = await lf.api.traceGet(summary.id)
      const md = full?.metadata ?? {}
      const inMetadata = md[matchKey] === matchVal
      const inInput =
        full?.input != null && JSON.stringify(full.input).includes(matchVal)
      const inOutput =
        full?.output != null && JSON.stringify(full.output).includes(matchVal)
      if (inMetadata || inInput || inOutput) {
        matching.push({ id: full.id, name: full.name, metadata: md })
      }
    } catch {
      // Skip individual fetch failures; the retry loop handles eventual
      // consistency at the chain level.
    }
  }
  return matching
}
