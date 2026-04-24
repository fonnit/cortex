---
phase: 04-retrieval
plan: "03"
subsystem: ui
tags: [react, nextjs, fetch, prisma, ask, retrieval, metrics]

requires:
  - phase: 04-02
    provides: POST /api/ask — embed, ANN retrieve, Haiku synthesis, structured AskResponse

provides:
  - AskPage at /ask — 'use client' component with serif input, cx-cite badge answers, scrollable sources list, history sidebar
  - /api/metrics citedAnswers wired — filed items ingested in past 7 days as proxy count

affects:
  - admin (AdminView "Cited answers / wk" cell now shows real number)
  - 04-04 (any plan needing the Ask surface or metrics)

tech-stack:
  added: []
  patterns:
    - "Client fetch pattern: useState + async handleSubmit + fetch POST + setResult, identical to design prototype flow"
    - "citedAnswers proxy: count filed items by ingested_at window — avoids Unsupported halfvec(512) filter limitation"

key-files:
  created:
    - app/(app)/ask/page.tsx
  modified:
    - app/api/metrics/route.ts

key-decisions:
  - "Sidebar Ask nav item and all cx-ask* CSS classes were already present — no layout.tsx or globals.css changes needed"
  - "Kbd defined inline in AskPage — no shared component export; consistent with TriageView and AxisGroup patterns"
  - "citedAnswers proxy omits embedding IS NOT NULL filter (Unsupported type); count is approximate by design per plan spec"
  - "History sidebar click triggers a fresh fetch rather than caching the prior result — correct behavior for re-submission"

patterns-established:
  - "AskPage submit disables button during loading (T-04-11 DoS mitigation from threat model)"

requirements-completed:
  - RET-05
  - RET-03
  - RET-02

duration: 15min
completed: 2026-04-24
---

# Phase 04 Plan 03: Ask UI Summary

**AskPage client component at /ask — serif input → POST /api/ask → cx-cite badge answers with anchor-linked sources list; citedAnswers wired in /api/metrics via filed-item count proxy**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-24T20:14:00Z
- **Completed:** 2026-04-24T20:29:25Z
- **Tasks:** 2 (Task 3 is checkpoint:human-verify — pending)
- **Files modified:** 2

## Accomplishments

- AskPage translates design/project/views.jsx AskView exactly — same cx-* class names, same grid structure, same form/answer/sources/aside layout
- Submit handler fetches POST /api/ask, sets result state; button disabled during load (threat T-04-11 mitigated)
- Sources list renders `id="src-N"` anchors; cx-cite badges link `#src-N` for in-page scroll
- /api/metrics citedAnswers replaced from `null` to live Prisma count of filed items ingested in past 7 days

## Task Commits

1. **Task 1: AskPage client component** - `e9922c8` (feat)
2. **Task 2: Wire citedAnswers in /api/metrics** - `12453d9` (feat)

**Plan metadata:** (pending — created after self-check)

## Files Created/Modified

- `app/(app)/ask/page.tsx` — 'use client' AskPage; useState question/result/loading/error/history; handleSubmit + handleHistoryClick; full cx-ask layout
- `app/api/metrics/route.ts` — added citedAnswersProxy to Promise.all; replaced citedAnswers: null with live count

## Decisions Made

- Sidebar Ask nav item (`{ id: 'ask', label: 'Ask', kbd: 'A' }`) was already in Sidebar.tsx from a prior commit — no change needed.
- All cx-ask* CSS classes were already in app/globals.css — no globals.css change needed.
- Kbd defined inline (no shared export exists in codebase; TriageView, AxisGroup each define their own).
- citedAnswers proxy uses `ingested_at >= 7 days ago` with `status: 'filed'`; omits embedding filter per plan spec (Prisma Unsupported type).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — all pre-conditions (sidebar nav, CSS classes) were already satisfied by prior phases.

## Known Stubs

- Aside "this week" stat shows `history.length` (session count) for cited answers and static "—%" for marked useful — both intentional per plan spec (no feedback tracking in MVP; no AskCall table).
- These are acknowledged MVP limitations, not blocking the plan goal.

## Threat Surface

No new trust boundaries introduced. AskPage is a pure client-side fetch to an existing authenticated endpoint (/api/ask). Matches T-04-09 (accept), T-04-10 (accept), T-04-11 (mitigate — implemented: button disabled during load).

## User Setup Required

None — no new external services.

## Next Phase Readiness

- /ask is functional end-to-end pending human checkpoint verification
- /api/metrics citedAnswers returns a real integer — AdminView "Cited answers / wk" cell live
- Human checkpoint (Task 3) requires browser verification at http://localhost:3000/ask

---
*Phase: 04-retrieval*
*Completed: 2026-04-24*
