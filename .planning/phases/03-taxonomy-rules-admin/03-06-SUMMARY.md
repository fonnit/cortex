---
phase: 03-taxonomy-rules-admin
plan: "06"
subsystem: ui, api
tags: [next, react-query, prisma, admin, metrics, sparkline, tanstack-query]

requires:
  - phase: 03-01
    provides: Rule model + prisma.rule queries
  - phase: 03-04
    provides: RulesView page structure and pattern reference
  - phase: 02-02
    provides: MetricsStrip component with Phase 2 stubs

provides:
  - GET /api/metrics extended with dormantRatio, medianRulesInCtx, queueTrend, weeklyPulse
  - app/(app)/admin/page.tsx — AdminView with 3-card top row + cx-admin-table
  - Sparkline SVG component (local to admin page)
  - MetricsStrip Phase 3 stubs wired (labelAutoPct, dormantRatio, medianDecisionSec display pattern)

affects:
  - phase-4 (weeklyPulse, medianDecisionSec wired but null until Phase 4)
  - MetricsStrip consumers (layout.tsx interface updated to match extended shape)

tech-stack:
  added: []
  patterns:
    - "useQuery(['metrics']) shared key between AdminPage and MetricsStrip for React Query cache deduplication"
    - "Sparkline as local SVG component — no external dep, ported from design/project/views.jsx"
    - "dormantRatio computed server-side via allRules filter (not stored separately)"
    - "medianRulesInCtx computed via prefilter_bucket grouping + sorted bucket-size median"

key-files:
  created:
    - app/(app)/admin/page.tsx
  modified:
    - app/api/metrics/route.ts
    - components/shell/MetricsStrip.tsx
    - app/(app)/layout.tsx

key-decisions:
  - "rulesCount switches from taxonomyLabel.count to rule.count({ status: 'active' }) — prior query was wrong model"
  - "labelAutoPct proxied from auto_filed_rate (same as relevanceAutoPct) until Phase 4 provides a separate label metric"
  - "weeklyPulse is null — Phase 4 / manual input; field exists in response so frontend is ready"
  - "layout.tsx AppShell MetricsResponse interface updated to match extended shape (Rule 2: missing critical sync)"

patterns-established:
  - "Admin page uses placeholderData so UI renders immediately on mount with zero values"
  - "Sparkline guards values.length < 2 to avoid divide-by-zero in range computation"

requirements-completed:
  - OBS-02
  - OBS-03
  - OBS-04

duration: 2min
completed: 2026-04-24
---

# Phase 03 Plan 06: Admin Page + Extended Metrics Summary

**AdminView page at /admin with live Neon data — 3-card top row (queue depths + sparkline, rule health, pulse) and metrics table; /api/metrics extended with dormantRatio, medianRulesInCtx, queueTrend; MetricsStrip Phase 3 stubs wired**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-24T20:11:03Z
- **Completed:** 2026-04-24T20:13:00Z
- **Tasks:** 2 (+ 1 human-verify checkpoint pending)
- **Files modified:** 4

## Accomplishments

- Extended GET /api/metrics with 4 new Phase 3 fields: dormantRatio, medianRulesInCtx, queueTrend (8-day sparkline), weeklyPulse (null placeholder)
- Created /admin page matching AdminView design prototype — cx-admin-top 3-card row, cx-admin-table with 7 metric rows and pass/fail dot indicators
- Ported Sparkline SVG component from design/project/views.jsx with values.length guard
- Wired MetricsStrip Phase 3 stubs: labelAutoPct (toFixed), dormantRatio (Math.round), medianDecisionSec (template literal)
- Updated MetricsResponse interface in both MetricsStrip and layout.tsx to match extended shape

## Task Commits

1. **Task 1: Extend /api/metrics + AdminView page** - `25c9ebd` (feat)
2. **Task 2: Wire MetricsStrip Phase 3 stubs** - `50c4dc1` (feat)

## Files Created/Modified

- `app/(app)/admin/page.tsx` — AdminView client component with Sparkline, 3-card top row, 7-row metrics table
- `app/api/metrics/route.ts` — Extended GET handler: allRules query, dormantRatio, medianRulesInCtx, queueTrend, weeklyPulse
- `components/shell/MetricsStrip.tsx` — Interface updated; stub cells use template literal formatting
- `app/(app)/layout.tsx` — AppShell MetricsResponse interface synced to extended shape

## Decisions Made

- rulesCount now queries `prisma.rule.count({ status: 'active' })` — the prior implementation used `prisma.taxonomyLabel.count` which was the wrong model for the Rule system
- labelAutoPct proxied from `snapshot.auto_filed_rate` (same source as relevanceAutoPct) until Phase 4 instruments a separate label metric
- layout.tsx AppShell interface updated as a Rule 2 deviation — leaving it stale would cause silent TS drift as the shared query key means AdminPage and MetricsStrip consume the same cache

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed wrong Prisma model for rulesCount**
- **Found during:** Task 1 (reading existing /api/metrics route.ts)
- **Issue:** Original handler used `prisma.taxonomyLabel.count` for the `rules` field — taxonomyLabel counts deprecated labels, not Rules
- **Fix:** Changed to `prisma.rule.count({ where: { user_id: userId, status: 'active' } })`
- **Files modified:** app/api/metrics/route.ts
- **Verification:** tsc --noEmit exits 0; field name and intent now match
- **Committed in:** 25c9ebd (Task 1 commit)

**2. [Rule 2 - Missing Critical] Updated layout.tsx MetricsResponse interface**
- **Found during:** Task 2 (TypeScript verification)
- **Issue:** AppShell used the old Phase 2 interface shape — would silently diverge from the extended /api/metrics response
- **Fix:** Updated interface to include medianRulesInCtx, queueTrend, weeklyPulse
- **Files modified:** app/(app)/layout.tsx
- **Verification:** tsc --noEmit exits 0
- **Committed in:** 50c4dc1 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical interface sync)
**Impact on plan:** Both fixes required for correctness. No scope creep.

## Issues Encountered

None — plan executed cleanly. TypeScript passed on first run for both tasks.

## Known Stubs

- `weeklyPulse: null` in /api/metrics response — Phase 4 / manual input. UI renders "—" correctly.
- `medianDecisionSec: null` — no TriageDecision table yet. Display pattern wired; becomes live in Phase 4.
- `labelAutoPct` proxied from `auto_filed_rate` — same value as relevanceAutoPct until a separate label metric is instrumented.

## Checkpoint Pending

Task 3 is a `checkpoint:human-verify` — human must verify /admin, /taxonomy, and /rules pages render correctly with real data and dark mode before Phase 3 is marked complete.

Verification steps: run `npm run dev`, sign in, visit /admin, /taxonomy, /rules and check visual correctness per the checkpoint instructions in 03-06-PLAN.md.

## Next Phase Readiness

- Phase 3 code complete — all three pages (taxonomy, rules, admin) implemented
- /api/metrics returns all Phase 3 fields with live Neon data
- Human visual checkpoint is the only remaining gate before Phase 3 is done
- Phase 4 can pick up weeklyPulse and medianDecisionSec as null fields already in the response shape

---
*Phase: 03-taxonomy-rules-admin*
*Completed: 2026-04-24*
