---
phase: 01-foundation
plan: "06"
subsystem: observability
tags: [langfuse, neon, metrics, typescript, tracing]

requires:
  - phase: 01-04
    provides: Item ingest pipeline (handleFile, handleGmailMessage) with Neon writes
  - phase: 01-05
    provides: Stage 2 label classifier and classification_trace JSONB writes

provides:
  - "snapshotMetrics() writes daily MetricSnapshot rows to Neon with uncertain_rate and auto_filed_rate"
  - "computeMetrics() queries Neon Item table for rate calculations over any time window"
  - "langfuse_trace_id embedded in classification_trace JSONB on every Item row"
  - "Daily snapshot timer in daemon: 10s startup delay then every 24h interval"

affects: [01-foundation, phase-2-triage-ui, admin-metrics, observability]

tech-stack:
  added: []
  patterns:
    - "Trace ID capture: traceClient = langfuse.trace(...); traceId = traceClient.id — stored in JSONB for item-trace linkability"
    - "Metrics timer pattern: setTimeout(fn, 10_000) for startup + setInterval(fn, 24h) for recurring"
    - "Rate formula: uncertain_rate = uncertain / (uncertain + certain + ignored); auto_filed_rate = certain / (certain + uncertain)"

key-files:
  created:
    - agent/src/metrics.ts
  modified:
    - agent/src/index.ts

key-decisions:
  - "langfuse_trace_id stored in classification_trace JSONB (not a separate column) — no schema migration needed; trace linkability from day one"
  - "Metrics timer fires 10s after daemon start to allow initial items to process before first snapshot"
  - "uncertain_rate denominator includes ignored items — reflects true classification volume, not just items that reached triage"

patterns-established:
  - "classification_trace JSONB always includes langfuse_trace_id as first field"
  - "snapshotMetrics() is fire-and-catch — errors logged to Langfuse but do not crash daemon"

requirements-completed:
  - OBS-01
  - OBS-06

duration: 12min
completed: 2026-04-24
---

# Phase 01 Plan 06: Langfuse Instrumentation + Daily Metrics Snapshot Summary

**Langfuse trace IDs embedded in Neon classification_trace JSONB on all Item rows; daily MetricSnapshot writes uncertain_rate and auto_filed_rate to Neon from daemon startup**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-24T18:30:00Z
- **Completed:** 2026-04-24T18:42:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `agent/src/metrics.ts` created: `computeMetrics()` queries Neon Item by status, computes both rates; `snapshotMetrics()` inserts MetricSnapshot row
- `langfuse_trace_id` embedded in `classification_trace` JSONB on all four Item write paths (ignore, uncertain, processing INSERT, keep UPDATE)
- Daily snapshot timer wired in daemon main block: 10s startup delay + 24h interval; errors fire-and-caught to Langfuse trace, never crash daemon
- Gmail handler updated with its own `gmailTraceClient` capture and trace ID embedding

## Task Commits

1. **Task 1: Daily metrics snapshot writer** - `1951a1d` (feat)
2. **Task 2: Store Langfuse trace IDs on Item rows + wire daily snapshot** - `a484af8` (feat)

## Files Created/Modified

- `agent/src/metrics.ts` — MetricSnapshot writer: `computeMetrics()` + `snapshotMetrics()` exports
- `agent/src/index.ts` — traceClient capture on every langfuse.trace() call, langfuse_trace_id in all classification_trace writes, snapshotMetrics import and daily timer

## Decisions Made

- Store `langfuse_trace_id` in existing `classification_trace` JSONB rather than a new column — avoids a schema migration, trace linkability available from day one.
- Metrics timer uses 10-second startup delay so initial ingested items are processed before the first snapshot queries them.
- `uncertain_rate` denominator includes `ignored` items (not just uncertain+certain) to reflect true classification volume.

## Deviations from Plan

None — plan executed exactly as written. The plan's note about using `classification_trace` JSONB for trace ID storage was followed directly.

## Issues Encountered

None — TypeScript compiled clean on first attempt for both tasks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- OBS-01 and OBS-06 fully satisfied: every classify call has a Langfuse trace; MetricSnapshot rows are written from daemon startup.
- The core hypothesis (uncertain_rate trends down over time) is now measurable from day one of operation.
- Phase 1 foundation complete; ready for Phase 2 triage UI.

---
*Phase: 01-foundation*
*Completed: 2026-04-24*
