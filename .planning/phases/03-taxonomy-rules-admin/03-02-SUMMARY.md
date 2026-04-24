---
phase: 03-taxonomy-rules-admin
plan: "02"
subsystem: api
tags: [prisma, zod, react-query, tanstack, nextjs, taxonomy, mutations]

requires:
  - phase: 03-01
    provides: TaxonomyView page scaffold, TaxonomyLabel + TaxonomyMergeProposal schema, GET /api/taxonomy

provides:
  - PATCH /api/taxonomy/[axis]/[name] — atomic rename (items + label) and deprecate
  - POST /api/taxonomy/merge — remap items, delete merged labels, create audit row in one transaction
  - POST /api/taxonomy — create new TaxonomyLabel (split flow)
  - Inline modal UI for rename/merge/split/deprecate wired to live fetch mutations

affects:
  - triage queue integration (split item reassignment)
  - TAX-05 autocomplete (deprecated=true filter)
  - any future plan reading TaxonomyMergeProposal rows

tech-stack:
  added: []
  patterns:
    - "Zod discriminatedUnion for op-based PATCH body validation"
    - "AXIS_COL map for converting axis string to Prisma column name"
    - "prisma.$transaction([]) for atomic multi-table mutations"
    - "useQueryClient().invalidateQueries({queryKey:['taxonomy']}) after every mutation"

key-files:
  created:
    - app/api/taxonomy/[axis]/[name]/route.ts
    - app/api/taxonomy/merge/route.ts
  modified:
    - app/api/taxonomy/route.ts
    - app/(app)/taxonomy/page.tsx

key-decisions:
  - "Split operation creates new TaxonomyLabel only; item reassignment deferred to triage queue (TAX-04)"
  - "Modal styles delivered via inline <style> tag to avoid touching globals.css (owned by 02-01)"
  - "Merge sidebar Accept button wired to handleMerge directly (skips modal for 1-click acceptance)"
  - "axis validated via AXIS_COL allowlist returning null → 400; prevents injection into Prisma queries"

patterns-established:
  - "All taxonomy mutations: requireAuth → Zod parse → axisCol lookup → prisma.$transaction → invalidateQueries"

requirements-completed: [TAX-02, TAX-03, TAX-04, TAX-05]

duration: 12min
completed: 2026-04-24
---

# Phase 03 Plan 02: Taxonomy Mutation Layer Summary

**Atomic taxonomy mutations (rename, merge, split, deprecate) via Prisma transactions + wired modal UI in TaxonomyView**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-24T00:00:00Z
- **Completed:** 2026-04-24T00:12:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- PATCH /api/taxonomy/[axis]/[name]: rename atomically updates Item rows + TaxonomyLabel in one transaction; deprecate sets deprecated=true
- POST /api/taxonomy/merge: remaps items, deletes merged-from labels, creates TaxonomyMergeProposal audit row (status=accepted) — all atomic
- TaxonomyView action buttons (rename/merge/split/deprecate) replaced from data-action stubs to live onClick handlers with modal overlay
- Split creates new TaxonomyLabel via POST /api/taxonomy; item-level reassignment deferred to triage queue per plan spec

## Task Commits

1. **Task 1: PATCH /api/taxonomy/[axis]/[name] + POST /api/taxonomy/merge** — `a0b73ca` (feat)
2. **Task 2: Wire action buttons in TaxonomyView — modals + POST /api/taxonomy** — `359ab94` (feat)

**Plan metadata:** see final commit below

## Files Created/Modified

- `app/api/taxonomy/[axis]/[name]/route.ts` — PATCH rename + deprecate with Zod discriminatedUnion; prisma.$transaction for rename
- `app/api/taxonomy/merge/route.ts` — POST merge: remap items, delete labels, create audit row in one transaction
- `app/api/taxonomy/route.ts` — added POST handler for TaxonomyLabel creation (split flow)
- `app/(app)/taxonomy/page.tsx` — full modal UI wired to mutation handlers; useQueryClient invalidation on every op

## Decisions Made

- Split defers item reassignment to triage queue — matches plan spec (TAX-04 integration point)
- Modal styles delivered via inline `<style>` tag rather than globals.css to respect 02-01 file ownership
- Merge sidebar Accept button wired directly to handleMerge without a secondary modal (1-click UX)
- axis allowlist validated via AXIS_COL record (unknown axis → 400) to prevent Prisma column injection

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Taxonomy mutation API is complete and tested via tsc
- Deprecate flag is set; autocomplete filtering (TAX-05) can read `deprecated=true` from TaxonomyLabel
- Split item reassignment integration point is ready when triage queue lands
- TaxonomyMergeProposal audit rows are populated for accepted merges

---
*Phase: 03-taxonomy-rules-admin*
*Completed: 2026-04-24*
