---
phase: 04-retrieval
plan: "01"
subsystem: embedding-pipeline
tags: [embeddings, cron, pgvector, langfuse, openai]
dependency_graph:
  requires: [03-taxonomy-rules-admin]
  provides: [item-embeddings, hnsw-index]
  affects: [04-02-PLAN.md]
tech_stack:
  added: [openai text-embedding-3-small@512d, @neondatabase/serverless raw SQL, halfvec HNSW index]
  patterns: [cron-auth-guard, langfuse-span-wrap, raw-sql-halfvec-write]
key_files:
  created:
    - lib/embed.ts
    - app/api/cron/embed/route.ts
    - prisma/migrations/20260424000000_hnsw_index/migration.sql
    - prisma/migrations/20260424000000_hnsw_index/migration.json
  modified: []
decisions:
  - buildEmbedText extracts subject from source_metadata JSON at runtime — no schema change needed
  - embedTexts owns no Langfuse span; cron route owns the full trace
  - halfvec writes via @neondatabase/serverless neon() — Prisma cannot write Unsupported columns
metrics:
  duration: "10 minutes"
  completed: "2026-04-24"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 04 Plan 01: Embedding Pipeline Summary

OpenAI text-embedding-3-small@512d embeddings for filed items via Vercel Cron, with HNSW index and Langfuse observability.

## What Was Built

### lib/embed.ts
- `embedTexts(texts: string[]): Promise<number[][]>` — calls `text-embedding-3-small` with `dimensions: 512`; returns one vector per input
- `buildEmbedText(item)` — concatenates `filename | axis_type | axis_from | axis_context | subject` (non-null fields); falls back to `filename ?? 'untitled'`

### app/api/cron/embed/route.ts
- CRON_SECRET header guard (T-04-01)
- Queries up to 50 `status='filed'` items with `embedding IS NULL` (T-04-03 hard cap)
- Langfuse trace + span wrapping the OpenAI call
- Writes halfvec per item via `neon()` raw SQL: `UPDATE "Item" SET embedding = '[...]'::halfvec WHERE id = $id`
- Returns `{ embedded: N }` on success; `500` on error with console.error

### prisma/migrations/20260424000000_hnsw_index/
- `migration.sql`: `CREATE INDEX CONCURRENTLY IF NOT EXISTS item_embedding_hnsw ON "Item" USING hnsw (embedding halfvec_ip_ops) WITH (m = 16, ef_construction = 64)`
- `migration.json`: Prisma migration manifest (checksum blank — index is DDL-only, not schema-gen)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | e8dcfb5 | embedTexts helper + HNSW migration |
| 2 | 5206180 | POST /api/cron/embed route |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — all surfaces were in the plan's threat model (T-04-01, T-04-02, T-04-03).

## Self-Check: PASSED

- FOUND: lib/embed.ts
- FOUND: app/api/cron/embed/route.ts
- FOUND: prisma/migrations/20260424000000_hnsw_index/migration.sql
- Commit e8dcfb5: verified
- Commit 5206180: verified
- TypeScript: no errors reported in lib/embed.ts or app/api/cron/embed/route.ts
