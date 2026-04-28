---
quick_id: 260428-jrt
description: Stage 1 removal + ingest routing change
date: 2026-04-28
status: complete
commits: [0b9d32c, 0dbc534]
net_delta: +108 / -1217
---

# Quick Task 260428-jrt: Stage 1 removal + ingest routing change

## Outcome

Stage 1 (relevance-gate LLM call before content classification) is removed. Ingest now routes by file size:

| Size | Status |
|------|--------|
| `< STAGE1_MIN_SIZE_BYTES` (1 MiB) | `pending_stage2` |
| `>= 1 MiB` or unknown | `uncertain` (lands in triage UI) |

The constant was renamed `STAGE1_MIN_SIZE_BYTES` → `TRIAGE_MIN_SIZE_BYTES` to reflect the new semantics ("at-or-above this goes straight to triage").

The defensive default for items with missing `size_bytes` flipped from `pending_stage1` → `uncertain` — without a Stage 1 worker, sending an item to `pending_stage1` would strand it; sending it to triage lets a human handle it.

`/api/classify` `stage:1` schema branch is left intact for cheap back-compat (no callers).

## Commits

- **0b9d32c** `feat(quick-260428-jrt-1)`: retarget /api/ingest large/unknown items to 'uncertain'
  - `lib/queue-config.ts` — rename constant
  - `app/api/ingest/route.ts` — routing rule
  - `__tests__/ingest-routing.test.ts` — TDD-first behavior assertions
  - `__tests__/ingest-api.test.ts` — drop stale `STAGE1_MIN_SIZE_BYTES` reference (deviation rule 3)

- **0dbc534** `chore(quick-260428-jrt-2)`: drop Stage 1 worker, prompt builder, and tests
  - DELETE `agent/src/consumer/stage1.ts`
  - DELETE `agent/__tests__/consumer-stage1.test.ts`
  - `agent/src/consumer/prompts.ts` — drop `buildStage1Prompt`
  - `agent/src/consumer/index.ts` — drop `runStage1Worker` bootstrap
  - `agent/__tests__/consumer-prompts.test.ts` — strip Stage 1 cases
  - `agent/__tests__/consumer-bootstrap.test.ts` — strip Stage 1 worker assertions
  - `agent/__tests__/consumer-stage2.test.ts` — drop `runStage1Worker` import + Test 10 (concurrent pools no longer applies; deviation rule 3)

## Verification

- 105/105 tests pass across the 7 plan-named suites: `ingest-routing`, `queue-config`, `ingest-api`, `consumer-prompts`, `consumer-bootstrap`, `consumer-stage2`, `consumer-stage2-prompt`.
- Symbol grep is clean across `lib/`, `app/`, `__tests__/`, `agent/`:
  - `STAGE1_MIN_SIZE_BYTES` — 0 matches
  - `buildStage1Prompt` — 0 matches
  - `runStage1Worker` — 0 matches
  - `consumer/stage1` — 0 matches

## Deviations Applied

1. **Stale comment in `__tests__/ingest-api.test.ts`** referenced `STAGE1_MIN_SIZE_BYTES` — updated to new name (Task 1 commit).
2. **Stale `runStage1Worker` import in `agent/__tests__/consumer-stage2.test.ts`** would have prevented the suite from compiling after `stage1.ts` deletion. Removed import + Test 10 (concurrent Stage 1 + Stage 2 pools no longer applies). Rolled into Task 2 commit.

## Deferred (Out of Scope, Pre-existing on Baseline 50331dd)

3 unrelated test failures reproduced on the parent baseline; none caused by this plan:
- `consumer-claude` env-scrub
- `queue-api-integration` snapshot missing the h9w `paths` route
- `triage-api` Item-shape type errors

## Next

- Quick task B: Stage 2 agentic-loop + endpoint enrichment (samples + corrections)
- Then: reset Neon DB, run `process-files.ts` file-by-file with manual approval gates
