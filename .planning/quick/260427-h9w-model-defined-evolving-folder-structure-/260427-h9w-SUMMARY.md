# Quick Task 260427-h9w: Model-defined evolving folder structure — Summary

**Completed:** 2026-04-27
**Commits:** cf9781a (h9w-1), 2260988 (h9w-2), 04ade42 (h9w-3)

## What changed

The fixed `<type>/<from>/<context>/<filename>` Stage 2 path template is gone.
Claude now sees the existing tree of confirmed parent directories (with file
counts) and proposes a `proposed_drive_path` of arbitrary depth — reusing
folders when the new item belongs in one, branching when it doesn't.

Auto-file gating moved from "all 3 axis values exist in TaxonomyLabel" to
"parent of proposed path has ≥3 confirmed-filed items AND path_confidence ≥0.85".
The 3-axis schema (type/from/context) is preserved as searchable metadata —
axes still flow end-to-end, they just don't drive the path anymore.

## Three landed slices

### h9w-1 (cf9781a) — `/api/paths/internal` endpoint

- New `app/api/paths/internal/route.ts`: GET-only, requireApiKey, returns
  `{ paths: [{ parent, count }] }` sorted by count desc, capped at 50.
- Daemon-side: `getPathsInternal()` in `agent/src/http/client.ts` with the same
  retry semantics as `getTaxonomyInternal`.
- `middleware.ts`: added `/api/paths/internal(.*)` to the public allowlist.

### h9w-2 (2260988) — Stage 2 prompt + worker

- `agent/src/consumer/prompts.ts`: `buildStage2Prompt(item, taxonomy, paths)`.
  Old fixed-template line replaced with tree injection (paths-block) + reuse-or-
  branch + arbitrary depth + emit `path_confidence`.
- `agent/src/consumer/stage2.ts`: `Stage2ResultSchema` requires
  `path_confidence: number (0..1)` at the top level. Worker calls
  `getPathsInternal` once per non-empty batch; fetch failure skips the batch
  with the same backoff as taxonomy-fetch failure.
- Updated tests in `consumer-stage2-prompt.test.ts` and `consumer-stage2.test.ts`.

### h9w-3 (04ade42) — `/api/classify` cold-start guard swap

- Removed: `taxonomyLabel.findMany` cold-start load, `allLabelsExist`,
  `isExistingLabel`, `unknown_label` block reason.
- Added: `PATH_AUTO_FILE_MIN_SIBLINGS=3`, `PATH_AUTO_FILE_MIN_CONFIDENCE=0.85`,
  optional `path_confidence` on the Stage 2 success branch of
  `ClassifyBodySchema`, parent extraction (`slice(0, lastIndexOf('/')+1)`),
  `prisma.item.count` query gated behind cheaper checks (T-h9w-07 mitigation).
- New auto-file gate: `decision==='auto_file' && allHighConf && allValuesPresent
  && pathConfidenceOk && siblingCount >= 3`.
- `path_confidence` persists in `classification_trace.stage2` jsonb (no Prisma
  migration).
- `__tests__/classify-auto-actions.test.ts`: rewritten — replaced
  `taxonomyLabel.findMany` mock with `prisma.item.count` mock, dropped
  `ALL_LABELS_PRESENT`, added H9W-1 through H9W-12 (incl. behavior-change test
  H9W-6 confirming new axis labels no longer block auto-file).
- `agent/__tests__/consumer-prompts.test.ts`: updated for h9w-2 signature change
  and wgk's relaxed "may propose new labels" copy.
- `jest.config.js`: excluded `.claude/worktrees/` from test discovery so
  orphan executor worktrees stop shadowing real test runs.

## Behavior changes (operator-visible)

- **No more 1-folder-per-file under `/invoice/`**: Claude is told to reuse
  existing parents when an item belongs there. With zero filed items today,
  the first 5–15 items will route to `uncertain` and require human triage —
  acceptable because the tree must bootstrap from real human filing.
- **Auto-file is silent until folders stabilize**: with <3 confirmed siblings
  in any parent, no item auto-files. Once Daniel triages 3+ items into
  `/fonnit/invoices/` (or wherever), similar future items can fire.
- **New axis labels no longer block auto-file**: an item with a brand-new
  `axis_type` value can still auto-file as long as the path-based gate passes.
  TaxonomyLabel-based vocabulary control is no longer a runtime guard at the
  classify route (still emitted as searchable metadata).

## Out of scope (intentional)

- No Drive bootstrap — fresh start by design (CONTEXT.md decision).
- No reclassification of items already in `pending_stage2`/`uncertain` — they
  keep their old proposed paths until a future cleanup task.
- No triage UI changes — backend classification only. Surfacing the tree to
  the user is a follow-up.
- No multi-tenant scoping on `/api/paths/internal` (mirrors taxonomy/internal;
  flagged as TODO(v1.2) in the route).

## Known edge case (accepted, documented)

`proposed_drive_path='/file.pdf'` → parent `'/'` → `startsWith '/'` matches
every confirmed path. Documented as YAGNI in the route's comment block; the
user can always undo via triage. Test H9W-12 asserts current behavior.

## Pre-existing test failures (NOT caused by this task)

Three suites fail in the working tree both before and after h9w-3 (same
failures as the stashed baseline):

- `agent/__tests__/consumer-claude.test.ts` — env var snapshot mismatch from
  commit 1c5b7c3 (`env: process.env` for keychain access).
- `__tests__/triage-api.test.ts` — TS error about missing Item properties
  (schema drift unrelated to h9w).
- `__tests__/queue-api-integration.test.ts` — pre-existing.

## Verification

- `npx jest __tests__/classify-auto-actions.test.ts` → 16/16 passed.
- `npx jest agent/__tests__/consumer-stage2.test.ts agent/__tests__/consumer-stage2-prompt.test.ts` → 131/131 passed (10 suites).
- `npx jest agent/__tests__/consumer-prompts.test.ts` → 29/29 passed.
- `git diff prisma/schema.prisma` → empty. No migration.
- `grep -n "allLabelsExist\|isExistingLabel\|taxonomyLabel\.findMany" app/api/classify/route.ts` → zero hits.
- `grep -n "<type>/<from>/<context>" agent/src/consumer/prompts.ts` → zero hits.

## Next steps (separate work)

- Deploy via `vercel deploy --prod --yes` and restart agents.
- Watch the queue: first ~5–15 items expected at `uncertain`; auto-file should
  start firing once Daniel triages 3+ items into common folders.
- Pre-existing test failures + 10 stuck `error` items + .claude/.playwright-mcp/
  gitignore are out of scope for this task.
