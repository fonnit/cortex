---
phase: 03-taxonomy-rules-admin
plan: "01"
subsystem: taxonomy
tags: [taxonomy, api, schema, ui, prisma]
dependency_graph:
  requires: []
  provides: [GET /api/taxonomy, TaxonomyView page, TaxonomyMergeProposal schema]
  affects: [03-02, 03-03]
tech_stack:
  added: [TaxonomyMergeProposal Prisma model]
  patterns: [requireAuth + prisma pattern, useQuery 30s refetch, data-action attributes for future mutation wiring]
key_files:
  created:
    - app/(app)/taxonomy/page.tsx
    - app/api/taxonomy/route.ts
  modified:
    - prisma/schema.prisma
decisions:
  - "Action buttons (rename/merge/split/deprecate) rendered with data-action attributes only — mutation handlers deferred to plan 03-02 as specified"
  - "MergeProposal field uses suggested_canonical (snake_case) from DB, not suggestedCanonical — matches Prisma model directly"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-24"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
---

# Phase 03 Plan 01: Taxonomy List View Summary

Three-axis tabbed TaxonomyView with live Neon data via GET /api/taxonomy, plus TaxonomyMergeProposal Prisma model.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add TaxonomyMergeProposal schema model + GET /api/taxonomy | 04be62a | prisma/schema.prisma, app/api/taxonomy/route.ts |
| 2 | TaxonomyView page — three-tab table + merge proposal sidebar | e2fd67f | app/(app)/taxonomy/page.tsx |

## What Was Built

**GET /api/taxonomy** (`app/api/taxonomy/route.ts`): Parallel Prisma queries for TaxonomyLabel and TaxonomyMergeProposal. Transforms labels by axis ('type' → types, 'from' → entities, 'context' → contexts). Returns `{ types, entities, contexts, mergeProposals }`. requireAuth() gates all queries; all Prisma queries filter by user_id.

**TaxonomyMergeProposal model** (`prisma/schema.prisma`): id, user_id, axis, a, b, evidence, suggested_canonical, status (default "pending"), created_at, updated_at. Indexed on [user_id, status] and [user_id, axis] for plan 03-03 nightly job queries.

**TaxonomyView** (`app/(app)/taxonomy/page.tsx`): Client Component. Three tabs switching list content. useQuery fetches /api/taxonomy with 30s refetch. Table: name, item count, last-used (toLocaleDateString), four action buttons with data-action attributes. Aside: merge proposal sidebar with pair, evidence, canonical, and Accept/Edit/Reject buttons.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data sourced from /api/taxonomy. Action buttons (rename/merge/split/deprecate) are display-only with data attributes per plan spec; wiring deferred to 03-02 by design.

## Threat Flags

No new threat surface beyond what the plan's threat model covers. requireAuth() and user_id filtering applied as specified (T-03-01-01, T-03-01-02 mitigated).

## Self-Check: PASSED

- app/(app)/taxonomy/page.tsx: FOUND
- app/api/taxonomy/route.ts: FOUND
- prisma/schema.prisma contains "model TaxonomyMergeProposal": FOUND
- Commits 04be62a and e2fd67f: FOUND
