/**
 * Integration tests — exercise the queue route's atomic-claim, stale-reclaim,
 * and legacy-reclaim SQL against an in-memory Postgres (pg-mem). These tests
 * are NOT mocked DB stubs: pg-mem actually parses and executes the SQL we
 * emit, so jsonb_set arity, path expressions, and status transitions are
 * validated at phase close — not just substring-grepped.
 *
 * NOTE on pg-mem caveats: pg-mem 3.x is single-threaded so `FOR UPDATE SKIP
 * LOCKED` cannot be exercised under real concurrency — Test 15 instead
 * validates the SELECT-then-UPDATE row-state structure that underpins the
 * skip-locked guarantee. The Postgres lock-skipping itself is taken on faith
 * from the Postgres docs; pg-mem accepts the syntax and treats it as a no-op.
 *
 * If pg-mem's SQL parser/runner rejects any operator surface at runtime,
 * each affected `it(...)` block documents the specific failure inline as a
 * comment and falls back to a smoke check (assert SQL parses without
 * throwing). We never silently downgrade to substring-grep alone.
 */

// Mock langfuse before importing the route — the route module imports
// `langfuse` at top-level, and langfuse-core's media subsystem invokes a
// dynamic ESM import that explodes under jest's CJS environment without
// --experimental-vm-modules. This integration test only consumes the route's
// `_*ForTest` SQL helpers, never the GET handler, so the mock can be a stub.
jest.mock('langfuse', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    trace: () => ({ id: 't_int', span: () => ({ end: jest.fn() }) }),
    flushAsync: jest.fn().mockResolvedValue(undefined),
  })),
}))
// Mock @neondatabase/serverless too — same reason, the route imports it but
// these tests never invoke the GET handler.
jest.mock('@neondatabase/serverless', () => ({ neon: jest.fn() }))
// Defensive stub for lib/prisma — after the nic refactor the route imports
// `prisma` from '@/lib/prisma' at top-level. Loading lib/prisma for real in
// jest pulls in PrismaNeon → @neondatabase/serverless internals that the
// stubbed module above does not satisfy. This integration test only consumes
// the route's `_*ForTest` SQL helpers (pure functions), never the GET handler
// nor the prisma client — so a {} stub is enough to satisfy module-load.
jest.mock('@/lib/prisma', () => ({ prisma: {} }))

import { newDb, DataType } from 'pg-mem'
import {
  _atomicClaimSqlForTest,
  _staleReclaimSqlForTest,
  _legacyReclaimSqlForTest,
} from '../app/api/queue/route'

type PgClient = {
  connect: () => Promise<void>
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
  end: () => Promise<void>
}

/**
 * Creates a fresh in-memory Postgres with a minimal "Item" table that mirrors
 * the columns the queue SQL touches. We do NOT replicate the full Prisma
 * schema — only the fields the SQL reads/writes.
 *
 * pg-mem 3.x does not natively implement `jsonb_set`, the `?` operator, or
 * `#>>` paths. We register polyfills so the route's actual SQL strings can
 * execute against the in-memory engine. These polyfills mirror Postgres
 * semantics closely enough for our test fixtures — they are not a full
 * pgvector/jsonb reimplementation.
 */
function setupDb(): { client: PgClient } {
  // noAstCoverageCheck: true is required because pg-mem's AST walker rejects
  // queries that contain syntax it parses-but-ignores. Our atomic-claim SQL
  // includes `FOR UPDATE SKIP LOCKED` — pg-mem accepts it as a no-op (the
  // engine is single-threaded, so there is no concurrency to skip), but the
  // strict coverage check fires because nothing reads the `skip locked` AST
  // node. Disabling the check is the documented workaround per pg-mem's own
  // jsdoc on `noAstCoverageCheck`. We are validating the SELECT-then-UPDATE
  // structural correctness; the lock-skipping itself is a Postgres guarantee.
  const db = newDb({ noAstCoverageCheck: true })

  // jsonb_set(target jsonb, path text[], new_value jsonb, create_missing bool)
  // We support the 4-arg form the route uses. Path elements are walked into
  // the target object; missing keys create empty objects when create_missing
  // is true. The whole result is JSON.parse(JSON.stringify(target)) so we
  // never share refs with the caller's input.
  db.public.registerFunction({
    name: 'jsonb_set',
    args: [DataType.jsonb, DataType.text, DataType.jsonb, DataType.bool],
    returns: DataType.jsonb,
    allowNullArguments: true,
    implementation: (target: unknown, pathStr: string, value: unknown, createMissing: boolean) => {
      // pg arrays come in as text like '{queue,stage1,last_claim_at}'
      const path = String(pathStr ?? '')
        .replace(/^\{/, '')
        .replace(/\}$/, '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      const root: Record<string, unknown> =
        target && typeof target === 'object' ? JSON.parse(JSON.stringify(target)) : {}
      let cur: Record<string, unknown> = root
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i]
        if (typeof cur[k] !== 'object' || cur[k] === null) {
          if (!createMissing) return target
          cur[k] = {}
        }
        cur = cur[k] as Record<string, unknown>
      }
      cur[path[path.length - 1]] = value
      return root
    },
  })

  // to_jsonb(text) — wrap a text value as a json string scalar
  db.public.registerFunction({
    name: 'to_jsonb',
    args: [DataType.text],
    returns: DataType.jsonb,
    implementation: (v: string) => v,
  })

  // jsonb #>> text[] — extract path as text. text[] arrives as '{queue,stage1,last_claim_at}'.
  db.public.registerOperator({
    operator: '#>>',
    left: DataType.jsonb,
    right: DataType.text, // pg-mem represents text[] params as text in this surface
    returns: DataType.text,
    allowNullArguments: true,
    implementation: (target: unknown, pathStr: string) => {
      if (target == null) return null
      const path = String(pathStr ?? '')
        .replace(/^\{/, '')
        .replace(/\}$/, '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      let cur: unknown = target
      for (const k of path) {
        if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[k]
        } else {
          return null
        }
      }
      return cur == null ? null : typeof cur === 'string' ? cur : JSON.stringify(cur)
    },
  })

  // jsonb ? text — does the top-level json object contain this key
  db.public.registerOperator({
    operator: '?',
    left: DataType.jsonb,
    right: DataType.text,
    returns: DataType.bool,
    allowNullArguments: true,
    implementation: (target: unknown, key: string) => {
      if (!target || typeof target !== 'object') return false
      return Object.prototype.hasOwnProperty.call(target, key)
    },
  })

  db.public.none(`
    CREATE TABLE "Item" (
      id text PRIMARY KEY,
      user_id text NOT NULL DEFAULT 'cortex_owner',
      status text NOT NULL,
      content_hash text,
      source text,
      filename text,
      mime_type text,
      size_bytes int,
      source_metadata jsonb,
      classification_trace jsonb,
      ingested_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  const { Client } = db.adapters.createPg()
  const client: PgClient = new Client()
  return { client }
}

describe('queue SQL — integration against pg-mem', () => {
  it('Test 14: atomic claim transitions all pending rows to processing and writes last_claim_at', async () => {
    const { client } = setupDb()
    await client.connect()

    // Insert 3 pending_stage1 rows with distinct ingested_at values
    await client.query(
      `INSERT INTO "Item" (id, status, content_hash, source, ingested_at) VALUES
        ('row_a', 'pending_stage1', 'h_a', 'downloads', now() - interval '3 minutes'),
        ('row_b', 'pending_stage1', 'h_b', 'downloads', now() - interval '2 minutes'),
        ('row_c', 'pending_stage1', 'h_c', 'downloads', now() - interval '1 minute')
      `,
    )

    const nowIso = new Date().toISOString()
    const { text, values } = _atomicClaimSqlForTest(1, 10, nowIso)
    const result = await client.query(text, values)

    expect(result.rows).toHaveLength(3)
    // All three should have transitioned to processing_stage1
    const statuses = result.rows.map((r) => r.status)
    expect(statuses).toEqual(['processing_stage1', 'processing_stage1', 'processing_stage1'])

    // classification_trace.queue.stage1.last_claim_at populated for each row
    for (const row of result.rows) {
      const trace = row.classification_trace as { queue?: { stage1?: { last_claim_at?: string } } }
      expect(trace?.queue?.stage1?.last_claim_at).toBe(nowIso)
    }

    // Verify the rows in the table itself reflect the new status
    const after = await client.query(`SELECT id, status FROM "Item" ORDER BY ingested_at ASC`)
    expect(after.rows.map((r) => r.status)).toEqual([
      'processing_stage1',
      'processing_stage1',
      'processing_stage1',
    ])

    await client.end()
  })

  it('Test 15: sequential claim — second call returns only still-pending rows, no id overlap (status WHERE-filter narrows)', async () => {
    const { client } = setupDb()
    await client.connect()

    // KNOWN PG-MEM LIMITATION (documented inline):
    // pg-mem 3.x's UPDATE...WHERE id IN (SELECT...LIMIT N) ignores the LIMIT
    // clause inside the subquery (verified empirically — the engine returns
    // all matching rows regardless of LIMIT, both as parameter $5 and as a
    // literal integer). The CTE rewrite (`WITH cte AS (SELECT...LIMIT)
    // UPDATE...`) raises NotSupported. The Postgres-level LIMIT semantic is
    // taken on faith from the Postgres documentation.
    //
    // What we DO validate here: the WHERE-filter that underpins the
    // FOR UPDATE SKIP LOCKED row-narrowing — claimed rows transition to
    // processing_stage1 and are therefore filtered out of the next claim.
    // This is the structural property that makes SKIP LOCKED safe under
    // Postgres concurrency: rows already in `processing_stage{N}` cannot be
    // re-claimed by a subsequent caller because the inner SELECT's
    // `WHERE status = 'pending_stage1'` narrows them out.
    //
    // 5 pending rows, then claim, then claim again. The second claim must
    // return ZERO rows (since the first claim transitioned all of them to
    // processing_stage1 — pg-mem's missing LIMIT means we claim them all).
    await client.query(
      `INSERT INTO "Item" (id, status, content_hash, source, ingested_at) VALUES
        ('r1', 'pending_stage1', 'h1', 'downloads', now() - interval '5 minutes'),
        ('r2', 'pending_stage1', 'h2', 'downloads', now() - interval '4 minutes'),
        ('r3', 'pending_stage1', 'h3', 'downloads', now() - interval '3 minutes'),
        ('r4', 'pending_stage1', 'h4', 'downloads', now() - interval '2 minutes'),
        ('r5', 'pending_stage1', 'h5', 'downloads', now() - interval '1 minute')
      `,
    )

    const now1 = new Date().toISOString()
    const first = _atomicClaimSqlForTest(1, 3, now1)
    const r1 = await client.query(first.text, first.values)
    // pg-mem ignores LIMIT inside the subquery — all 5 are claimed.
    // In real Postgres this would be 3, but the WHERE-filter behavior is
    // identical. Assert all returned rows transitioned and have last_claim_at.
    expect(r1.rows.length).toBeGreaterThan(0)
    const firstIds = new Set(r1.rows.map((r) => r.id as string))
    for (const row of r1.rows) {
      expect(row.status).toBe('processing_stage1')
      const trace = row.classification_trace as { queue?: { stage1?: { last_claim_at?: string } } }
      expect(trace?.queue?.stage1?.last_claim_at).toBe(now1)
    }

    // Second claim — the WHERE-filter (status = 'pending_stage1') excludes
    // the rows we just claimed, so this returns zero rows. This is the
    // QUE-02 invariant in structural form: a row in processing_stage1 is
    // not eligible for re-claim under any caller.
    const now2 = new Date().toISOString()
    const second = _atomicClaimSqlForTest(1, 3, now2)
    const r2 = await client.query(second.text, second.values)
    const secondIds = new Set(r2.rows.map((r) => r.id as string))

    // No id overlap between the two batches — the QUE-02 invariant
    for (const id of secondIds) {
      expect(firstIds.has(id)).toBe(false)
    }
    // After both calls, every row should be processing_stage1 (no row stuck
    // in pending — the only way both batches share zero ids is via the
    // status filter)
    const after = await client.query(`SELECT status FROM "Item"`)
    for (const row of after.rows) {
      expect(row.status).toBe('processing_stage1')
    }

    await client.end()
  })

  it('Test 16: stale reclaim moves a stale processing_stage1 row back to pending_stage1', async () => {
    const { client } = setupDb()
    await client.connect()

    // Insert a row stuck in processing_stage1 with last_claim_at 11 minutes ago
    const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString()
    await client.query(
      `INSERT INTO "Item" (id, status, content_hash, source, classification_trace, ingested_at) VALUES
        ('stuck_row', 'processing_stage1', 'h_stuck', 'downloads',
         $1::jsonb,
         now() - interval '20 minutes')
      `,
      [JSON.stringify({ queue: { stage1: { last_claim_at: elevenMinAgo } } })],
    )

    const cutoffIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { text, values } = _staleReclaimSqlForTest(1, cutoffIso)
    const result = await client.query(text, values)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('stuck_row')
    expect(result.rows[0].status).toBe('pending_stage1')

    // Confirm in the table
    const after = await client.query(`SELECT status FROM "Item" WHERE id = 'stuck_row'`)
    expect(after.rows[0].status).toBe('pending_stage1')

    await client.end()
  })

  it('Test 17: legacy reclaim with NO stage2 trace routes to pending_stage1', async () => {
    const { client } = setupDb()
    await client.connect()

    // Legacy v1.0 row — bare 'processing' status, no stage2 trace, ingested 11 min ago
    await client.query(
      `INSERT INTO "Item" (id, status, content_hash, source, classification_trace, ingested_at) VALUES
        ('legacy_no_stage2', 'processing', 'h_legacy_a', 'downloads', NULL,
         now() - interval '11 minutes')
      `,
    )

    const cutoffIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { text, values } = _legacyReclaimSqlForTest(cutoffIso)
    const result = await client.query(text, values)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('legacy_no_stage2')
    expect(result.rows[0].status).toBe('pending_stage1')

    const after = await client.query(`SELECT status FROM "Item" WHERE id = 'legacy_no_stage2'`)
    expect(after.rows[0].status).toBe('pending_stage1')

    await client.end()
  })

  it('Test 18: legacy reclaim WITH stage2 trace routes to pending_stage2', async () => {
    const { client } = setupDb()
    await client.connect()

    // Legacy row that already had stage2 progress before getting stuck — must
    // be routed back to pending_stage2 (not stage1) so we don't redo Stage 1.
    await client.query(
      `INSERT INTO "Item" (id, status, content_hash, source, classification_trace, ingested_at) VALUES
        ('legacy_with_stage2', 'processing', 'h_legacy_b', 'downloads',
         $1::jsonb,
         now() - interval '11 minutes')
      `,
      [JSON.stringify({ stage2: { axes: { type: { value: 'invoice', confidence: 0.8 } } } })],
    )

    const cutoffIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { text, values } = _legacyReclaimSqlForTest(cutoffIso)
    const result = await client.query(text, values)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('legacy_with_stage2')
    expect(result.rows[0].status).toBe('pending_stage2')

    const after = await client.query(
      `SELECT status FROM "Item" WHERE id = 'legacy_with_stage2'`,
    )
    expect(after.rows[0].status).toBe('pending_stage2')

    await client.end()
  })
})
