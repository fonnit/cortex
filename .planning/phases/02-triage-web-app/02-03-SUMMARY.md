---
phase: 02-triage-web-app
plan: 03
subsystem: ui
tags: [triage, react-query, keyboard, langfuse, jest, zod, prisma, clerk]

requires:
  - phase: 02-02
    provides: Topbar component at components/shell/Topbar.tsx, ReactQueryProvider, authenticated app shell layout
  - phase: 02-01
    provides: lib/auth.ts requireAuth/auth(), lib/prisma.ts singleton, Clerk middleware

provides:
  - GET /api/triage — returns authenticated user's uncertain items with derived stage field
  - POST /api/triage — applies keep/ignore/skip/archive/confirm decisions with Zod validation
  - components/triage/SourceBadge.tsx — cx-badge with colored dot per source
  - components/triage/AxisGroup.tsx — label mode axis UI with proposals, confident, new-category inline form
  - components/triage/ExpandedCard.tsx — expanded card body for both relevance and label modes, cx-path Drive path display
  - components/triage/TriageView.tsx — main triage client component with keyboard handler, state, React Query
  - app/(app)/triage/page.tsx — triage page wiring Topbar + TriageView
  - jest + ts-jest test infrastructure + 10 passing API route tests

affects:
  - 02-04 (taxonomy/rules/admin — shell structure unchanged; triage API pattern repeatable)
  - 02-05 (observability — Langfuse triage.decision events are now emitted)

tech-stack:
  added:
    - jest (29.x)
    - @types/jest
    - ts-jest
    - jest-environment-node
    - jest.config.js + tsconfig.test.json (test infrastructure)
  patterns:
    - "TDD RED/GREEN: failing test committed before implementation"
    - "Clerk modal guard: document.querySelector('[data-clerk-modal]') in global keydown handler"
    - "Stage derivation: classification_trace.stage2.proposals existence → label vs relevance"
    - "All Prisma writes use where: { id, user_id } — cross-user tamper prevention (T-02-06)"
    - "Optimistic updates via useMutation onMutate + local decided map; refetch on settled"
    - "lastAction.current for single-level undo; openedAt.current for Langfuse decision timing"

key-files:
  created:
    - app/api/triage/route.ts
    - components/triage/SourceBadge.tsx
    - components/triage/AxisGroup.tsx
    - components/triage/ExpandedCard.tsx
    - components/triage/TriageView.tsx
    - app/(app)/triage/page.tsx
    - __tests__/triage-api.test.ts
    - jest.config.js
    - tsconfig.test.json
  modified: []

key-decisions:
  - "cx-card-head rendered as div (not button) — whole li handles click when collapsed (TRI-07/TRI-08 per prototype)"
  - "Langfuse triage.decision event emitted client-side (new Langfuse() per action) — Phase 2 doesn't persist timing to Neon per TRI-10 research decision"
  - "jest + ts-jest chosen over vitest — plan Task 1 action specified jest; tsconfig.test.json added since project has no root tsconfig"
  - "Acceptance criteria grep for 'key === k' is a typo in plan — prototype uses const k = e.key.toLowerCase(); k === 'k' is correct"

requirements-completed:
  - TRI-01
  - TRI-02
  - TRI-03
  - TRI-04
  - TRI-05
  - TRI-06
  - TRI-07
  - TRI-08
  - TRI-09
  - TRI-10
  - DSN-05

duration: 45min
completed: 2026-04-24
---

# Phase 02 Plan 03: Triage Queue Summary

**Keyboard-first inline-expanding triage queue with GET/POST API, two-mode card rendering, undo/toast, Drive path display, and Langfuse decision timing**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-04-24T00:00:00Z
- **Completed:** 2026-04-24
- **Tasks:** 3 (Task 1 TDD: RED commit + GREEN commit)
- **Files created:** 9

## Accomplishments

- Full triage API: GET returns user-scoped uncertain items with derived stage; POST handles keep/ignore/skip/archive/confirm with Zod validation and user-scoped DB writes (STRIDE T-02-06/T-02-07)
- Three leaf components translated pixel-faithfully from design/project/triage.jsx: SourceBadge, AxisGroup (resolved/unresolved, confident display, new-category inline form), ExpandedCard (relevance + label modes, cx-path Drive path TRI-09)
- TriageView with complete keyboard handler: J/H navigate, K/X/S relevance, 1/2/3/N/A/I/Enter label, U undo; Clerk modal guard; openedAt timing; Langfuse triage.decision events (TRI-10)
- 10 jest tests covering auth gates, user scoping, stage derivation, all decision types

## Task Commits

1. **Task 1 RED: Failing triage-api tests** - `a6eee9e` (test)
2. **Task 1 GREEN: Triage API route** - `3d49678` (feat)
3. **Task 2: Leaf components** - `6c22906` (feat)
4. **Task 3: TriageView + triage page** - `b746ed8` (feat)

## Files Created

- `app/api/triage/route.ts` — GET queue (50 items, uncertain, user-scoped, stage derived) + POST decision (Zod validated, all types)
- `components/triage/SourceBadge.tsx` — cx-badge with colored dot per source
- `components/triage/AxisGroup.tsx` — axis UI: proposals, is-resolved/is-unresolved, confident display, new-category inline form
- `components/triage/ExpandedCard.tsx` — expanded card body: cx-card-preview, cx-card-reason, cx-axes + cx-path, cx-action-primary/ghost buttons
- `components/triage/TriageView.tsx` — main client component: keyboard handler, state, React Query, Langfuse timing, undo, toast
- `app/(app)/triage/page.tsx` — Server Component: Topbar + TriageView
- `__tests__/triage-api.test.ts` — 10 tests: GET/POST auth, user scoping, stage derivation, all decision types
- `jest.config.js` — ts-jest config, @/ path mapping, tsconfig.test.json
- `tsconfig.test.json` — test-only TS config (project has no root tsconfig.json)

## Decisions Made

- **cx-card-head is a div** — the plan and prototype both specify div (not button). The whole `<li>` handles onClick when !isActive (TRI-07/TRI-08).
- **Langfuse per-action** — `new Langfuse().event(...)` called client-side on each non-skip decision. No Neon timing column per the research decision for Phase 2.
- **tsconfig.test.json added** — project has no root tsconfig.json; ts-jest needs one for path resolution. Added minimal config for tests only.
- **Plan acceptance criteria typo** — plan says `grep "key === 'k'"` but prototype and implementation correctly use `const k = e.key.toLowerCase(); if (k === 'k')`. Implementation is correct; grep pattern in plan is wrong.

## Deviations from Plan

None — plan executed as written. Test infrastructure was specified in Task 1 action; tsconfig.test.json was a necessary addition (Rule 3: blocking issue — ts-jest couldn't resolve @/ paths without it).

## Issues Encountered

- `jest --testPathPattern` CLI flag was renamed to `--testPathPatterns` in the installed jest version — fixed in jest.config.js by removing the renamed field.
- ts-jest couldn't resolve `@/` paths in route files without a tsconfig with `paths` defined; added `tsconfig.test.json` as the ts-jest tsconfig.

## Threat Coverage

| Threat ID | Status |
|-----------|--------|
| T-02-06 | Mitigated — all prisma.item.update uses `where: { id, user_id }` |
| T-02-07 | Mitigated — GET filters `user_id: userId` |
| T-02-08 | Accepted — keyboard actions POST to authenticated API |
| T-02-09 | Mitigated — all item content via React text nodes |

## Known Stubs

None — all data flows from real API (/api/triage GET).

## Next Phase Readiness

- Triage queue is fully functional; connects to /api/triage when authenticated
- Sidebar queue counts already poll /api/metrics (Plan 02-02); counts accurate when items exist
- Plan 02-04 (taxonomy/rules/admin) can proceed — triage surface is complete

---
*Phase: 02-triage-web-app*
*Completed: 2026-04-24*
