---
phase: 03-taxonomy-rules-admin
plan: "03"
subsystem: api
tags: [taxonomy, fuzzy-matching, trigram, jaccard, cron, dedup]

requires:
  - phase: 03-taxonomy-rules-admin/03-01
    provides: TaxonomyLabel + TaxonomyMergeProposal schema models
  - phase: 03-taxonomy-rules-admin/03-02
    provides: taxonomy mutation layer + merge sidebar reading TaxonomyMergeProposal

provides:
  - labelSimilarity (max of trigram + Jaccard) in lib/taxonomy-fuzzy.ts
  - GET /api/taxonomy/check-duplicate — blocks near-duplicates at 0.85 threshold
  - POST /api/taxonomy/merge-proposals/cron — nightly pairwise scan, creates proposals at 0.82

affects:
  - taxonomy label creation (any UI calling POST /api/taxonomy should call check-duplicate first)
  - /taxonomy merge sidebar (proposals from cron appear automatically)

tech-stack:
  added: []
  patterns:
    - Pure-TS fuzzy similarity (no external deps): trigram + Jaccard, max composite
    - CRON_SECRET Bearer auth pattern; skipped when unset for dev safety
    - Batched createMany (50/batch) with skipDuplicates for idempotent cron runs

key-files:
  created:
    - lib/taxonomy-fuzzy.ts
    - app/api/taxonomy/check-duplicate/route.ts
    - app/api/taxonomy/merge-proposals/cron/route.ts
  modified:
    - vercel.json

key-decisions:
  - "labelSimilarity = max(trigram, Jaccard) — two algorithms complement each other; Jaccard catches token reordering, trigram catches substring overlap"
  - "Block threshold 0.85 > proposal threshold 0.82 — tighter gate for creation, looser scan for cron to surface near-misses Daniel may want to review"
  - "Cron skips pairs already in pending (either direction) — prevents proposal inbox flooding on repeated runs"
  - "Longer name suggested as canonical — heuristic: longer usually more specific"

patterns-established:
  - "labelSimilarity: single import, composites two algorithms, callers only depend on this function"
  - "Cron route: CRON_SECRET guard at top, skip if unset, catch-all error handler with console.error"

requirements-completed:
  - TAX-06
  - TAX-07

duration: 12min
completed: 2026-04-24
---

# Phase 03 Plan 03: Fuzzy Dedup Gate and Nightly Merge Proposal Job Summary

**Pure-TS trigram+Jaccard similarity utility blocking near-duplicate label creation at 0.85 and surfacing nightly merge proposals at 0.82 into the existing /taxonomy sidebar**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-24T20:00:00Z
- **Completed:** 2026-04-24T20:11:13Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- labelSimilarity utility in lib/taxonomy-fuzzy.ts — pure TS, no npm deps, O(n) per pair
- GET /api/taxonomy/check-duplicate returns exact match, near-match (>= 0.85), or clear with similarity score; scoped to userId via requireAuth
- POST /api/taxonomy/merge-proposals/cron scans all user/axis groups pairwise, creates TaxonomyMergeProposal rows for pairs >= 0.82 not already pending, batched createMany; vercel.json schedules at 03:00 UTC

## Task Commits

1. **Task 1: labelSimilarity utility + GET /api/taxonomy/check-duplicate** - `e2fa242` (feat)
2. **Task 2: Nightly merge proposal cron endpoint** - `a7b3d83` (feat)

## Files Created/Modified

- `lib/taxonomy-fuzzy.ts` — trigramSimilarity, jaccardSimilarity, labelSimilarity exports
- `app/api/taxonomy/check-duplicate/route.ts` — GET handler; 0.85 block threshold; exact match fast-path
- `app/api/taxonomy/merge-proposals/cron/route.ts` — POST handler; 0.82 proposal threshold; CRON_SECRET auth; batched createMany
- `vercel.json` — added cron entry for /api/taxonomy/merge-proposals/cron at 03:00 UTC daily

## Decisions Made

- labelSimilarity = max(trigram, Jaccard): complementary coverage — trigram catches substring overlap, Jaccard catches token reordering (e.g. "Financial Invoice" vs "Invoice Financial")
- Block threshold 0.85 higher than proposal threshold 0.82: creation gate is strict, cron is generous to surface candidates
- Cron deduplication checks both (a,b) and (b,a) key directions — prevents symmetric duplicates in the proposal inbox
- Longer label name suggested as canonical: heuristic for specificity

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no new environment variables required beyond CRON_SECRET (already described in plan; optional for dev, Vercel sets it in production).

## Next Phase Readiness

- check-duplicate is ready for integration into the taxonomy label creation flow (any UI form creating labels should call this endpoint before POST /api/taxonomy)
- Cron is live on deploy — proposals will appear in /taxonomy merge sidebar automatically on next nightly run
- Merge proposal sidebar already reads TaxonomyMergeProposal (03-02) — no page changes needed

---
*Phase: 03-taxonomy-rules-admin*
*Completed: 2026-04-24*
