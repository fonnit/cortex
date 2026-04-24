---
phase: 03-taxonomy-rules-admin
plan: 05
subsystem: api, ui
tags: [prisma, react, tanstack-query, zod, rule-system, two-phase-patch]

requires:
  - phase: 03-04
    provides: Rule schema + /api/rules GET + POST + RulesView page

provides:
  - PATCH /api/rules/[id] with two-phase preview/confirm flow
  - DELETE /api/rules/[id] soft-delete (status dormant)
  - Conflict detection via tokenJaccard >= 0.85 at preview time
  - Inline edit panel in RulesView with old/new diff display

affects:
  - any future phase reading or writing Rule records

tech-stack:
  added: []
  patterns:
    - "Two-phase mutation: preview (no DB write) then confirm (commit)"
    - "Ownership check: always verify rule.user_id === userId before mutate"
    - "Soft delete via status field to preserve historical fire data"
    - "Conflict detection reuses tokenJaccard inline, same threshold as POST"

key-files:
  created:
    - app/api/rules/[id]/route.ts
  modified:
    - app/(app)/rules/page.tsx

key-decisions:
  - "Used queryClient.invalidateQueries() directly (TQ v5) rather than destructured form from plan — plan pseudocode would not type-check"
  - "Conflict list returned on confirm phase too (ok: true, conflicts) so UI can warn even post-commit if needed"
  - "Provenance appends truncated old text (60 chars) to keep field short but auditable"

patterns-established:
  - "Two-phase PATCH pattern: no confirm = preview only; confirm=true = commit"
  - "Token Jaccard conflict detection reused from POST, same 0.85 threshold"

requirements-completed:
  - RUL-06

duration: 12min
completed: 2026-04-24
---

# Phase 03 Plan 05: Rule Edit with Preview Diff Summary

**Two-phase PATCH on /api/rules/[id] with tokenJaccard conflict detection, soft-delete, and inline edit panel wired into RulesView**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-24T00:00:00Z
- **Completed:** 2026-04-24T00:12:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- PATCH /api/rules/[id] preview phase returns { old, new, conflicts } with no DB write
- Confirm phase commits text update and appends truncated old text to provenance
- DELETE soft-deletes via status=dormant to preserve fire history
- Inline edit panel in RulesView: textarea, diff display, conflict warning, cancel

## Task Commits

1. **Task 1: PATCH /api/rules/[id] (preview + confirm) + DELETE** - `b9f6513` (feat)
2. **Task 2: Wire edit panel into RulesView page** - `4d64b6c` (feat)

## Files Created/Modified
- `app/api/rules/[id]/route.ts` - PATCH (preview + confirm) and DELETE handlers with ownership check and conflict detection
- `app/(app)/rules/page.tsx` - Extended with edit state, fetchPreview/confirmEdit handlers, and inline edit panel JSX

## Decisions Made
- Used `queryClient.invalidateQueries()` (TanStack Query v5 method call) instead of plan's destructured form which would not type-check in v5.
- Conflict list included in confirm response (`ok: true, conflicts`) for completeness.
- Provenance truncates old text at 60 chars with ellipsis to keep field bounded.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected useQueryClient usage for TanStack Query v5**
- **Found during:** Task 2 (edit panel wiring)
- **Issue:** Plan used `const { invalidateQueries } = useQueryClient()` — destructuring a method from a class instance loses `this` binding and does not match TQ v5 types
- **Fix:** Used `const queryClient = useQueryClient()` then `queryClient.invalidateQueries(...)` — correct v5 pattern
- **Files modified:** app/(app)/rules/page.tsx
- **Verification:** tsc --noEmit exits 0
- **Committed in:** 4d64b6c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — wrong method destructuring pattern)
**Impact on plan:** Zero scope change; only corrected the TQ v5 API call form.

## Issues Encountered
None beyond the TQ v5 pattern correction above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Rule CRUD surface is complete: GET, POST, PATCH (preview+confirm), DELETE
- Edit panel is inline — no modal or route change needed
- Conflict detection consistent between POST (block) and PATCH (warn before confirm)

---
*Phase: 03-taxonomy-rules-admin*
*Completed: 2026-04-24*
