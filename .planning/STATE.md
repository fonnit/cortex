---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: ingest-rearchitect
status: code_complete_pending_acceptance
stopped_at: v1.1 code-complete (4 phases, 8 plans, 32 requirements). Operator acceptance pending — see .planning/phases/08-operational-acceptance/RUNBOOK.md.
last_updated: "2026-04-28T13:46:57.997Z"
last_activity: 2026-04-28 — Completed quick task 260428-lx4: Stage 2 agentic-loop + MCP endpoint enrichment (cortex-tools MCP server with 3 tools; /api/labels/samples + /api/path-feedback)
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 8
  completed_plans: 8
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-25 — v1.1 marked shipped)

**Core value:** The triage feedback loop compounds fast enough that weekly triage load trends down — Cortex learns to file so Daniel doesn't have to.
**Current focus:** Operator acceptance for v1.1 (RUNBOOK.md → ACCEPTANCE.md), then plan v1.2

## Current Position

Phase: All v1.1 phases complete (5–8)
Plan: —
Status: Code-complete; live operator acceptance pending
Last activity: 2026-04-28 — Completed quick task 260428-lx4: Stage 2 agentic-loop + MCP endpoint enrichment (cortex-tools MCP server with 3 tools; /api/labels/samples + /api/path-feedback)

Progress: [██████████] 100% (v1.1 — 8/8 plans)

## Performance Metrics

**Velocity:**

- Total plans completed: 28 (cumulative across milestones — 20 v1.0 + 8 v1.1)
- Average duration: —
- Total execution time: ~1 day (v1.1 milestone)

**By Phase (v1.1):**

| Phase | Plans | Status |
|-------|-------|--------|
| 5. Queue & API Surface | 3/3 | Complete |
| 6. Daemon Thin Client | 2/2 | Complete |
| 7. Stage 1 & Stage 2 Consumers | 2/2 | Complete |
| 8. Operational Acceptance | 1/1 | Toolkit complete; live runs pending |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
v1.1 decisions all marked ✓ Shipped:

- Daemon must not access Neon directly (Phase 6)
- `claude -p` receives file paths, not content (Phase 7)
- Queue-driven consumers replace inline scan classification (Phases 5+7)

### Pending Todos

- Operator: run `.planning/phases/08-operational-acceptance/RUNBOOK.md` and fill in ACCEPTANCE.md
- Reconcile pre-existing `agent/src/auth/google.ts` working-tree edit (separate commit, outside v1.1 scope)
- Review the 15 deferred minor findings cataloged in `.planning/v1.1-MILESTONE-AUDIT.md` for v1.2 candidates

### Blockers/Concerns

(None — milestone code-complete. Live operator acceptance is by design.)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260426-u47 | Triage routing + Stage 2 auto-file/auto-ignore + cold-start guard | 2026-04-26 | dc997e0 | [260426-u47-triage-only-big-items-default-route-smal](./quick/260426-u47-triage-only-big-items-default-route-smal/) |
| 260426-wgk | Stage 2 may propose new taxonomy labels (bootstraps empty taxonomy) | 2026-04-26 | f094216 | [260426-wgk-stage-2-may-propose-new-taxonomy-labels-](./quick/260426-wgk-stage-2-may-propose-new-taxonomy-labels-/) |
| 260427-fpx | CxCombobox replaces datalist; cx-* styled, custom-value support, Playwright-verified | 2026-04-27 | dd2c64b | [260427-fpx-custom-combobox-input-dropdown-replaces-](./quick/260427-fpx-custom-combobox-input-dropdown-replaces-/) |
| 260427-h9w | Model-defined evolving folder structure: paths-internal endpoint + Stage 2 path_confidence + parent-≥3-siblings auto-file gate (replaces allLabelsExist) | 2026-04-27 | cf9781a, 2260988, 04ade42 | [260427-h9w-model-defined-evolving-folder-structure-](./quick/260427-h9w-model-defined-evolving-folder-structure-/) |
| 260427-tlk | Base-taxonomy seed (intent-driven archive) + triage-confirm bug fixes (TaxonomyLabel growth + status='filed' transition + path carry); auto-file verified via 8-file smoke test | 2026-04-27 | c291311, 42520f6 | [260427-tlk-base-taxonomy-seed](./quick/260427-tlk-base-taxonomy-seed/) |
| 260428-jrt | Stage 1 removal + ingest routing change (`<1MiB` → `pending_stage2`; `≥1MiB`/unknown → `uncertain` triage). Drop `runStage1Worker`, `consumer/stage1.ts`, `buildStage1Prompt`, Stage 1 tests. Rename `STAGE1_MIN_SIZE_BYTES` → `TRIAGE_MIN_SIZE_BYTES`. | 2026-04-28 | 0b9d32c, 0dbc534 | [260428-jrt-stage-1-removal-ingest-routing-change-fi](./quick/260428-jrt-stage-1-removal-ingest-routing-change-fi/) |
| 260428-lx4 | Stage 2 agentic-loop + MCP endpoint enrichment. New `/api/labels/samples` + `/api/path-feedback` routes; new `cortex-tools` stdio MCP server exposing 3 tools (`cortex_paths_internal`, `cortex_label_samples`, `cortex_path_feedback`). claude.ts wired with `--mcp-config` + `--max-budget-usd` cap; Stage 2 prompt restructured for tool-call loop. 121 plan-mandated jest assertions green; agent tsc clean. | 2026-04-28 | fa8ac18, ab647aa, 76e5fc4 | [260428-lx4-stage-2-agentic-loop-endpoint-enrichment](./quick/260428-lx4-stage-2-agentic-loop-endpoint-enrichment/) |

## Session Continuity

Last session: 2026-04-25
Stopped at: v1.1 closed; awaiting operator acceptance + next milestone planning
Resume file: None
