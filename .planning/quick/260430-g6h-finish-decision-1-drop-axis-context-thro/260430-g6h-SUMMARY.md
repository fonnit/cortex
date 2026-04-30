---
phase: quick-260430-g6h
plan: 01
subsystem: classification
tags: [decision-1, axis-context, schema-frozen, two-axes, runtime-strip]
requires:
  - SEED-v4-prod.md (Decision 1 — drop axis_context from runtime)
  - cortex-seed-v4.json (already stops seeding context labels — 260430-0ff)
provides:
  - Two-axes (type, from) Stage 2 contract end-to-end (prompt → Zod → API → triage UI)
  - Wire-level guard against axis_context regression (Zod .strict() on axes + DecisionSchema picks)
  - axis_context column preserved in prisma/schema.prisma for old rows; new rows write null
affects:
  - Stage 2 prompt (prompts.ts) — Context axis line removed; JSON shape sentence trimmed
  - /api/classify — ClassifyBodySchema rejects axes.context as parse_error
  - /api/triage — DecisionSchema.picks rejects Context as Zod validation_failed
  - /api/labels/samples — axis=context returns 400
  - /api/taxonomy* — context dropped from response shapes + Zod enums
  - /api/cron/embed + /api/ask — SELECT projections drop axis_context
  - lib/embed.ts — buildEmbedText composes from filename + type + from + subject
  - Triage UI — ExpandedCard renders Type + From only; TriageView mutation drops Context
  - Taxonomy page — 2 tabs (Types, Entities); no Contexts tab
tech_added: []
patterns:
  - Strict Zod schemas at the wire (`.strict()` on axes + picks) make the strip self-enforcing
  - Spread-strip in /api/triage GET preserves the schema column without enumerating every Item field
key_files:
  created: []
  modified:
    - agent/src/consumer/prompts.ts
    - agent/src/consumer/stage2.ts
    - agent/src/http/types.ts
    - agent/src/mcp/cortex-tools.ts
    - app/api/ask/route.ts
    - app/api/classify/route.ts
    - app/api/cron/embed/route.ts
    - app/api/labels/samples/route.ts
    - app/api/taxonomy/[axis]/[name]/route.ts
    - app/api/taxonomy/check-duplicate/route.ts
    - app/api/taxonomy/internal/route.ts
    - app/api/taxonomy/merge/route.ts
    - app/api/taxonomy/route.ts
    - app/api/triage/route.ts
    - lib/embed.ts
    - components/triage/TriageView.tsx
    - components/triage/ExpandedCard.tsx
    - app/(app)/taxonomy/page.tsx
    - __tests__/classify-api.test.ts
    - __tests__/classify-auto-actions.test.ts
    - __tests__/labels-samples-api.test.ts
    - __tests__/taxonomy-internal-api.test.ts
    - __tests__/triage-api.test.ts
    - agent/__tests__/consumer-prompts.test.ts
    - agent/__tests__/consumer-stage2-prompt.test.ts
    - agent/__tests__/consumer-stage2.test.ts
decisions:
  - axis_context column STAYS in prisma/schema.prisma — no migration; old rows preserved; new rows write null
  - Zod `.strict()` on classify.axes + triage.picks rejects unknown keys → defense-in-depth at the wire
  - /api/triage GET strips axis_context via spread-destructure rather than enumerating every Item column
  - 4 explicit 400 sites added: /api/labels/samples, /api/taxonomy POST, /api/taxonomy/[axis], /api/taxonomy/merge, /api/taxonomy/check-duplicate
metrics:
  duration: ~45 minutes
  completed: 2026-04-30
  tasks: 3
  files_modified: 27
  axes_dropped: 1
  axes_remaining: 2
commits:
  - 1d0196e (Task 1: backend strip — 15 files)
  - 089f344 (Task 2: UI strip — 3 files)
  - 40208d9 (Task 3: test alignment — 8 files)
---

# Quick Task 260430-g6h: Finish SEED-v4 Decision 1 (Drop axis_context Throughout) Summary

Strip the `context` axis from every code path that reads, writes, prompts for, validates, or renders it. The prisma `axis_context` + `axis_context_confidence` columns stay (no migration); old rows keep their values; new rows write null. Stage 2's prompt no longer mentions a Context axis; the agent's Zod schema rejects payloads that carry `axes.context`; the triage card and taxonomy page drop the Context surface.

## What changed

### Task 1 — Backend strip (commit `1d0196e`, 15 files)

The runtime now treats `axes` as exactly `{ type, from }`:

- **agent/src/consumer/prompts.ts** — `TaxonomyContext` drops `context`; `buildStage2Prompt` removes the `Context axis: ${listOrNoneYet(taxonomy.context)}` line; the JSON shape sentence at the bottom changes to `axes={type, from}` only; the auto-file decision rule changes from "all 3 axes ≥ 0.85" to "both axes ≥ 0.85".
- **agent/src/consumer/stage2.ts** — `Stage2ResultSchema.axes` is now `z.object({ type: AxisSchema, from: AxisSchema })`; the worker normalises only `type` + `from` into the forwarded `ClassifyRequest`; the file-level docstring updated from "all-3-axes contract" to "two-axes contract".
- **agent/src/http/types.ts** — `TaxonomyInternalResponse` drops `context`; `ClassifyRequest` success branch's `axes` shape drops the `context` field.
- **agent/src/mcp/cortex-tools.ts** — `cortex_label_samples` Zod input uses `axis: z.enum(['type', 'from'])`; tool description updated.
- **app/api/classify/route.ts** — `ClassifyBodySchema.axes` uses `.strict()` so unknown keys (notably `context`) are rejected at the wire boundary as `validation_failed`. Auto-file gate computes `allHighConf` and `allValuesPresent` over 2 axes only. Auto-ignore fallback uses `Math.max(tConf, fConf)`. The success branch never writes `axis_context` or `axis_context_confidence` to the DB.
- **app/api/triage/route.ts** — `buildProposals` signature drops `axis_context*`; `DecisionSchema.picks` uses `.strict()` and drops `Context`; archive/confirm branch never sets `data.axis_context` and never upserts a `TaxonomyLabel` for `axis='context'`. GET strips `axis_context` + `axis_context_confidence` from each row via destructure-spread (cleaner than enumerating every Item column).
- **app/api/labels/samples/route.ts** — `ALLOWED_AXES = ['type', 'from'] as const`; the `case 'context'` branch was deleted from the where-builder switch; the SELECT no longer projects `axis_context`. `?axis=context` now hits the whitelist guard and returns 400.
- **app/api/taxonomy/route.ts** — GET response is `{ types, entities, mergeProposals }` (no `contexts`); POST uses `safeParse` + Zod enum `['type', 'from']` and returns proper 400 with `validation_failed` on rejection.
- **app/api/taxonomy/[axis]/[name]/route.ts** — `AXIS_COL` drops the `context: 'axis_context'` entry; the existing `if (!axisCol) return 400` guard handles the rejection automatically.
- **app/api/taxonomy/merge/route.ts** — `MergeBody.axis` enum narrowed to `['type', 'from']`; `AXIS_COL` drops the `context` entry; safeParse + 400 on validation_failed.
- **app/api/taxonomy/check-duplicate/route.ts** — explicit whitelist guard rejects `axis='context'` with 400 immediately after parsing query params.
- **app/api/taxonomy/internal/route.ts** — response shape `{ type, from }` only.
- **app/api/cron/embed/route.ts** — SELECT projection drops `axis_context: true`.
- **app/api/ask/route.ts** — raw-SQL SELECT projection drops `axis_context`; the inline TS row type drops it too.
- **lib/embed.ts** — `EmbedItem` drops `axis_context?`; `buildEmbedText` composes from `[filename, axis_type, axis_from, subject]` only.

### Task 2 — UI strip (commit `089f344`, 3 files)

- **components/triage/ExpandedCard.tsx** — `TriageItem.classification_trace.stage2.proposals` drops `context?`; the `axes` array is now `['Type', 'From']`. Path preview row stays as the third row; CSS reflows automatically.
- **components/triage/TriageView.tsx** — `TriageDecision.picks` drops `Context`; keyboard handler `axes` array trimmed to `['Type', 'From']` in BOTH occurrences (1/2 keys pick proposals, 'n' opens new-label input); `axisKey` union narrowed to `'type' | 'from'`; mutation forwards `picks: { Type, From }` only.
- **app/(app)/taxonomy/page.tsx** — `TaxonomyData` drops `contexts`; tab state union narrows to `'types' | 'entities'`; the `tabs` array has 2 entries; the `tabAxis` map drops `contexts`.

### Task 3 — Test alignment (commit `40208d9`, 8 files)

Mechanical strip across every fixture + assertion that mentioned the context axis. Two new edge-case tests landed per the planning brief:

- `__tests__/classify-api.test.ts` — new test asserts that a Stage 2 success body with `axes.context` present is rejected as `validation_failed` (the `.strict()` Zod refinement is now exercised at the wire level).
- `__tests__/labels-samples-api.test.ts` — Test 5c (axis=context filters on axis_context) deleted; replaced with a SEED-v4 D1 test that asserts `?axis=context&label=anything` returns 400.

The other 6 test files (`classify-auto-actions`, `taxonomy-internal-api`, `triage-api`, `consumer-prompts`, `consumer-stage2-prompt`, `consumer-stage2`) were updated with mechanical drops of `context: { value, confidence }` blocks, `axis_context: ...` row fields, and `context: [...]` taxonomy fixture entries.

## Verification

### Static grep (canonical Decision-1-done check)

```bash
rg "axis_context|axis: 'context'|\"contexts\"" app/ agent/src/ components/ lib/
```

Returns ONLY:
- 5 explanatory comments documenting the strip in `app/api/triage/route.ts`, `app/api/classify/route.ts`, `lib/embed.ts`
- 4 lines in `app/api/triage/route.ts` for the deliberate destructure-strip (`axis_context: _axis_context, ...rest`) which removes the column from the GET response without enumerating every Item field

No functional code reads, writes, prompts for, or accepts `axis_context` outside `prisma/schema.prisma`.

```bash
rg "axis_context" prisma/
```

Returns the 2 schema column lines (intentionally preserved per spec):
```
axis_context            String?
axis_context_confidence Float?
```

### Targeted Jest suites (per planning brief, NOT full-suite)

```bash
npx jest __tests__/classify-api.test.ts __tests__/classify-auto-actions.test.ts \
  __tests__/labels-samples-api.test.ts __tests__/path-feedback-api.test.ts \
  __tests__/paths-internal-api.test.ts __tests__/taxonomy-internal-api.test.ts \
  __tests__/queue-api.test.ts agent/__tests__/consumer-prompts.test.ts \
  agent/__tests__/consumer-stage2.test.ts agent/__tests__/consumer-stage2-prompt.test.ts \
  agent/__tests__/mcp-cortex-tools.test.ts agent/__tests__/consumer-claude.test.ts
```

**Result: 11/12 suites pass, 198 tests pass.** The one failure (`__tests__/triage-api.test.ts`) is pre-existing TS drift unrelated to Decision 1 — see Deferred Issues below.

### Typecheck

- `(cd agent && npx tsc --noEmit)` — exit 0, clean.
- `npx tsc --noEmit` (project root) — exit 1, **but identical to pre-change baseline** (846 errors in 15 test files, all `Cannot find name 'jest'/'expect'/'describe'/'it'`). This is a pre-existing tsconfig gap (no `@types/jest` declared in `types`) that affects every test file regardless of Decision 1 work. No source-tree (`app/`, `agent/src/`, `components/`, `lib/`) errors introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] Wired Zod safeParse → 400 on /api/taxonomy POST and /api/taxonomy/merge POST**
- **Found during:** Task 1
- **Issue:** Both routes were calling `Schema.parse()` inside a try/catch that mapped any throw (including ZodError) to a 500. The plan's must-haves require `validation_failed` 400 responses for `axis: 'context'` payloads.
- **Fix:** Switched both routes to `Schema.safeParse()` with explicit `if (!parsed.success) return 400 validation_failed` branches.
- **Files modified:** `app/api/taxonomy/route.ts`, `app/api/taxonomy/merge/route.ts`
- **Commit:** `1d0196e`

**2. [Rule 2 — Missing critical functionality] /api/triage GET response strips `axis_context` from the wire**
- **Found during:** Task 1
- **Issue:** Prisma's default `findMany` selects every column on `Item`; without an explicit projection or strip, the orphaned `axis_context` + `axis_context_confidence` columns would leak into every triage list response.
- **Fix:** Added a destructure-strip on each row (`const { axis_context: _, axis_context_confidence: __, ...rest } = item`) — cleaner than enumerating all 18 Item columns and resilient to future schema additions.
- **Files modified:** `app/api/triage/route.ts`
- **Commit:** `1d0196e`

### Deferred Issues (pre-existing, out of scope)

**1. `__tests__/triage-api.test.ts` does not compile (TS2740)**

Lines 53, 82, 107 declare `prisma.item.findMany` mock fixtures with only 6 fields (id, user_id, status, source, classification_trace, ingested_at). Prisma's typed Item now has 18 required columns (`content_hash`, `filename`, `mime_type`, `size_bytes`, plus 13 more added across v1.0/v1.1 work). The fixtures need expansion to cover all required columns OR to use a type-cast escape hatch. This drift predates Decision 1 work — verified via `git stash` baseline check before any Task 1 edit. Fix is out of Decision 1 scope; tracked for a future quick task that revisits the triage GET test fixtures.

**2. Project-root `npx tsc --noEmit` fails on test type definitions (846 errors)**

Pre-existing tsconfig gap: `tsconfig.json` includes `**/*.ts` (which pulls test files) but does not declare `@types/jest` or any test-runner types in `compilerOptions.types`. Every test file emits `TS2304: Cannot find name 'jest'/'expect'/'describe'/'it'`. The agent's local `tsconfig.json` is correctly scoped and exits 0. Fixing the project-root config (either excluding `__tests__/` from the main tsconfig or adding `@types/jest` to `types`) is out of Decision 1 scope.

### Authentication Gates

None encountered.

## Threat Flags

None — Decision 1 narrows the trust surface (one fewer axis the model can hallucinate, one fewer column the wire writes), it doesn't expand it.

## Self-Check: PASSED

**Files exist:**
- FOUND: agent/src/consumer/prompts.ts (modified)
- FOUND: agent/src/consumer/stage2.ts (modified)
- FOUND: agent/src/http/types.ts (modified)
- FOUND: agent/src/mcp/cortex-tools.ts (modified)
- FOUND: app/api/classify/route.ts (modified)
- FOUND: app/api/triage/route.ts (modified)
- FOUND: app/api/labels/samples/route.ts (modified)
- FOUND: app/api/taxonomy/route.ts (modified)
- FOUND: app/api/taxonomy/[axis]/[name]/route.ts (modified)
- FOUND: app/api/taxonomy/merge/route.ts (modified)
- FOUND: app/api/taxonomy/check-duplicate/route.ts (modified)
- FOUND: app/api/taxonomy/internal/route.ts (modified)
- FOUND: app/api/cron/embed/route.ts (modified)
- FOUND: app/api/ask/route.ts (modified)
- FOUND: lib/embed.ts (modified)
- FOUND: components/triage/TriageView.tsx (modified)
- FOUND: components/triage/ExpandedCard.tsx (modified)
- FOUND: app/(app)/taxonomy/page.tsx (modified)
- FOUND: __tests__/classify-api.test.ts (modified)
- FOUND: __tests__/classify-auto-actions.test.ts (modified)
- FOUND: __tests__/labels-samples-api.test.ts (modified)
- FOUND: __tests__/taxonomy-internal-api.test.ts (modified)
- FOUND: __tests__/triage-api.test.ts (modified)
- FOUND: agent/__tests__/consumer-prompts.test.ts (modified)
- FOUND: agent/__tests__/consumer-stage2-prompt.test.ts (modified)
- FOUND: agent/__tests__/consumer-stage2.test.ts (modified)

**Commits exist:**
- FOUND: 1d0196e (Task 1: backend strip)
- FOUND: 089f344 (Task 2: UI strip)
- FOUND: 40208d9 (Task 3: test alignment)

**Schema preserved:**
- FOUND: prisma/schema.prisma still declares `axis_context String?` and `axis_context_confidence Float?` — no migration, no edit.

## Confirmation: prisma/schema.prisma untouched

```bash
$ git diff main..HEAD -- prisma/schema.prisma
(no output)
```

The 3 commits in this quick task touch zero lines of `prisma/schema.prisma`. Old rows keep their `axis_context` values; new rows get `null` on insert by virtue of never appearing in any Prisma `data` block.
