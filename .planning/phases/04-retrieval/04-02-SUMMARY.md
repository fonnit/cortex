---
phase: 04-retrieval
plan: 02
subsystem: ask-api
tags: [retrieval, rag, langfuse, anthropic, halfvec, clerk]
dependency_graph:
  requires: [04-01]
  provides: [POST /api/ask]
  affects: [AskView UI, Langfuse observability]
tech_stack:
  added: ["@anthropic-ai/sdk@^0.91.0"]
  patterns: [RAG-pipeline, halfvec-ANN, Langfuse-tracing, Zod-validation]
key_files:
  created:
    - app/api/ask/route.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - "@anthropic-ai/sdk was absent from package.json — installed ^0.91.0 (Rule 3 auto-fix)"
  - "ANN retrieval uses raw neon SQL (not Prisma) — halfvec <#> operator unsupported by Prisma ORM"
  - "Langfuse trace wraps three spans: embed-query, pgvector-ann, haiku-synthesis"
metrics:
  duration: "8 minutes"
  completed: "2026-04-24"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 3
---

# Phase 04 Plan 02: Ask API Summary

POST /api/ask — Clerk-authed RAG endpoint: embed query via text-embedding-3-small (512d), ANN retrieve top-20 filed items via halfvec inner product, synthesize top-5 with claude-haiku-4-5, return structured AskResponse with Langfuse tracing.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | POST /api/ask — embed, retrieve, synthesize | 4f26fb6 | app/api/ask/route.ts, package.json, package-lock.json |

## Implementation Details

**Auth:** `requireAuth()` from `lib/auth.ts` — throws a Response on missing session; caught and returned as 401.

**Input:** Zod schema `{ question: string().min(1).max(1000) }` — 400 on parse failure.

**Embed:** `embedTexts([question])` from `lib/embed.ts` — single call, returns `number[][]`, first element is the 512d query vector.

**ANN:** Raw neon tagged-template SQL, `ORDER BY embedding <#> ${vecStr}::halfvec LIMIT 20`, with `user_id = ${userId}` and `status = 'filed'` filters. Parameterized via neon template literals (T-04-05 mitigation).

**Synthesis:** Top-5 rows formatted as `[N] filename | path | type | filed` in system prompt. Haiku call: `model: 'claude-haiku-4-5'`, `max_tokens: 800`. Question injected into user message role only — system prompt is static (T-04-07 mitigation).

**Response:** Paragraphs split on double newlines; `[N]` patterns extracted into `cites: number[]`, stripped from `text`. AskResponse shape: `{ answer: [{text, cites}], sources: [{n, title, path, when}], latencyMs }`.

**Langfuse:** Three spans — `embed-query`, `pgvector-ann`, `haiku-synthesis` — all under one trace per request. `flushAsync()` called before return and on error path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] @anthropic-ai/sdk missing from package.json**
- **Found during:** Task 1 setup
- **Issue:** Package not listed in package.json; node_modules had no `@anthropic-ai/` directory
- **Fix:** `npm install @anthropic-ai/sdk` — added `^0.91.0` to dependencies
- **Files modified:** package.json, package-lock.json
- **Commit:** 4f26fb6

## Known Stubs

None.

## Threat Flags

No new threat surface introduced beyond the plan's threat model.

## Self-Check: PASSED

- `app/api/ask/route.ts` — FOUND
- Commit `4f26fb6` — FOUND (git log confirmed)
- TypeScript: zero code errors (two pre-existing tsconfig deprecation warnings unrelated to this plan)
