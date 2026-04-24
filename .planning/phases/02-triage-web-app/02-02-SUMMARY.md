---
phase: 02-triage-web-app
plan: 02
subsystem: app-shell
tags: [shell, sidebar, topbar, metrics-strip, react-query, clerk, prisma]

requires:
  - 02-01 (auth middleware, globals.css, prisma singleton, requireAuth)

provides:
  - Authenticated app shell layout at app/(app)/layout.tsx wrapping every protected route
  - Sidebar with Cortex logo, 5 nav items (triage/ask/taxonomy/rules/admin) + kbd shortcuts + live queue counts
  - Topbar component with eyebrow breadcrumb and right slot
  - MetricsStrip with 6 OBS-05 cells reading from /api/metrics at 30s intervals
  - GET /api/metrics — authenticated, aggregates MetricSnapshot + live Item queue counts + TaxonomyLabel count
  - ReactQueryProvider wrapper in lib/react-query.tsx

affects:
  - 02-03 (triage queue — slots into cx-main; Sidebar queue counts update from same /api/metrics)
  - 02-04 (taxonomy/rules/admin — rendered inside cx-main; shell wraps all)
  - 02-05 (observability — MetricsStrip is the OBS-05 delivery surface)

tech-stack:
  added: []
  patterns:
    - "usePathname() to derive active sidebar nav item — no separate route state"
    - "Shared useQuery(['metrics']) key between layout (10s) and MetricsStrip (30s) — single cache entry"
    - "requireAuth() throw-on-401 pattern in Route Handler; catch re-throws Response to Next.js"
    - "cx-app CSS grid: 232px sidebar column + 1fr content; sidebar spans 3 rows via grid-row: 1 / span 3"

key-files:
  created:
    - lib/react-query.tsx
    - components/shell/Sidebar.tsx
    - components/shell/Topbar.tsx
    - components/shell/MetricsStrip.tsx
    - app/(app)/layout.tsx
    - app/(app)/page.tsx
    - app/api/metrics/route.ts
  modified: []

key-decisions:
  - "MetricsStrip placed as direct child of cx-app div (not inside cx-main) — matches CSS grid-row: 2 placement from styles.css"
  - "Layout fetches metrics with 10s interval for sidebar queue counts; MetricsStrip uses same queryKey with 30s refetch — React Query deduplicates, 10s wins"
  - "Sidebar user footer reads from Clerk useUser() — live email address, not hardcoded stub"
  - "requireAuth() throws Response(401) which is caught in route handler and re-thrown to Next.js; non-Response errors return 500"

requirements-completed:
  - DSN-03
  - DSN-04
  - DSN-05
  - OBS-05

duration: 12min
completed: 2026-04-24
---

# Phase 2 Plan 02: App Shell — Sidebar, Topbar, MetricsStrip Summary

**Authenticated app shell: Clerk-aware sidebar with live queue counts, 6-cell OBS-05 metrics strip fed by /api/metrics aggregating MetricSnapshot and live Item counts**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-24T20:25:00Z
- **Completed:** 2026-04-24T20:37:00Z
- **Tasks:** 2
- **Files created:** 7

## Accomplishments

- app/(app)/layout.tsx wraps every authenticated route in the cx-app CSS grid — sidebar left column spanning all 3 rows, topbar/strip/main in right column
- Sidebar pixel-faithful to shell.jsx: Cortex logo SVG (rect + 3 path lines), 5 nav items with cx-nav-item / is-active state, cx-kbd shortcuts, cx-nav-count queue badges, cx-sidebar-foot with live Clerk user email
- /api/metrics fully authenticated via requireAuth(); queries MetricSnapshot (latest by captured_at), live Item counts filtered by user_id + status + axis_type, TaxonomyLabel count; returns Cache-Control: no-store
- MetricsStrip renders 6 cx-strip-cell elements matching design exactly; Phase 3/4 nulls display as em-dash; 30s refetch via React Query

## Task Commits

1. **Task 1: App shell layout + shell components** — `bb11678` (feat)
2. **Task 2: MetricsStrip component + /api/metrics route** — `84c4030` (feat)

## Files Created

- `lib/react-query.tsx` — QueryClientProvider with 10s stale/refetch defaults
- `components/shell/Sidebar.tsx` — cx-sidebar, cx-nav-item, cx-sidebar-foot; Clerk useUser for email
- `components/shell/Topbar.tsx` — cx-topbar with eyebrow and right slot
- `components/shell/MetricsStrip.tsx` — 6 cx-strip-cell; useQuery(['metrics'], 30s refetch)
- `app/(app)/layout.tsx` — ReactQueryProvider + cx-app grid + MetricsStrip wired in
- `app/(app)/page.tsx` — redirect() to /triage
- `app/api/metrics/route.ts` — GET, requireAuth, MetricSnapshot + Item counts + TaxonomyLabel count

## Decisions Made

- **usePathname() for active nav**: No separate route state — usePathname() splits on `/` to match the nav item id. Eliminates sync bug potential.
- **Shared React Query key**: Layout and MetricsStrip both use `['metrics']`. Layout refetches at 10s for queue counts; MetricsStrip at 30s for display. React Query uses the shorter interval — single network request serves both.
- **Clerk useUser() in sidebar footer**: Replaces hardcoded "daniel@fonnit.com" from design with live Clerk user email. Correctness requirement.

## Deviations from Plan

None — plan executed exactly as written. TypeScript check passed with zero errors on all new files.

## Known Stubs

- `weekly.citedAnswers: null` — Phase 4; MetricsStrip shows "—". Intentional per plan spec.
- `weekly.medianDecisionSec: null` — Phase 3; MetricsStrip shows "—". Intentional per plan spec.
- `auto.labelAutoPct: null` — Phase 3. Intentional per plan spec.
- `auto.dormantRatio: null` — Phase 3. Intentional per plan spec.
- Sidebar agent/gmail footer rows are static text ("launchd · connected", "synced · —") — real status wired in agent integration phase.

These stubs are plan-intentional placeholders. The metrics strip goal (OBS-05) is achieved for the two live cells: relevanceAutoPct (from MetricSnapshot) and rules count (from TaxonomyLabel).

## Threat Surface

T-02-04 mitigated: requireAuth() in /api/metrics; all DB queries filter by userId. Cache-Control: no-store prevents CDN caching of user-scoped data.

## Self-Check: PASSED

- `lib/react-query.tsx` exists and contains QueryClientProvider
- `components/shell/Sidebar.tsx` exists with cx-sidebar, cx-nav-item, cx-sidebar-foot
- `components/shell/Topbar.tsx` exists with cx-topbar
- `components/shell/MetricsStrip.tsx` exists with 6 cell definitions and cx-strip-cell
- `app/(app)/layout.tsx` exists with cx-app and ReactQueryProvider and MetricsStrip
- `app/(app)/page.tsx` exists with redirect('/triage')
- `app/api/metrics/route.ts` exists with requireAuth, metricSnapshot, taxonomyLabel, requireAuth
- Task 1 commit `bb11678` present
- Task 2 commit `84c4030` present
- `npx tsc --noEmit` — zero errors

---
*Phase: 02-triage-web-app*
*Completed: 2026-04-24*
