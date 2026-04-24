---
phase: 03-taxonomy-rules-admin
plan: "04"
subsystem: rules
tags: [rules, schema, api, cron, neon]
dependency_graph:
  requires: []
  provides: [rules-schema, api-rules, rules-view, consolidation-cron]
  affects: [prisma/schema.prisma, vercel.json]
tech_stack:
  added: []
  patterns: [token-jaccard-similarity, dormancy-computed-at-read, cron-secret-auth]
key_files:
  created:
    - prisma/schema.prisma (Rule + RuleConsolidationProposal models appended)
    - app/api/rules/route.ts
    - app/(app)/rules/page.tsx
    - app/api/rules/consolidation/cron/route.ts
  modified:
    - vercel.json
decisions:
  - Inline tokenJaccard in wave 1 (no dependency on lib/taxonomy-fuzzy.ts from 03-03 wave 3)
  - Dormancy computed at read time, not stored — last_fired_at is the ground truth
  - Consolidation cron uses 0.80 threshold (lower than write-time 0.85) to surface near-misses proactively
metrics:
  duration: ~8 minutes
  completed: 2026-04-24
  tasks_completed: 2
  files_created: 4
  files_modified: 1
requirements:
  - RUL-01
  - RUL-02
  - RUL-03
  - RUL-04
  - RUL-05
---

# Phase 03 Plan 04: Rule System Summary

One-liner: Neon-backed Rule model with 20-rule hard cap, 0.85 token-Jaccard redundancy check on write, server-side dormancy flagging, RulesView prototype-faithful UI, and Sunday weekly consolidation cron.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rule + RuleConsolidationProposal schema + /api/rules GET + POST | `6d47fd2` | prisma/schema.prisma, app/api/rules/route.ts |
| 2 | RulesView page + weekly consolidation cron | `c536c9c` | app/(app)/rules/page.tsx, app/api/rules/consolidation/cron/route.ts, vercel.json |

## What Was Built

**Schema (prisma/schema.prisma):**
- `Rule` model: id, user_id, text, prefilter_bucket, fires, last_fired_at, provenance, status; indexes on (user_id, status) and (user_id, prefilter_bucket)
- `RuleConsolidationProposal` model: id, user_id, rule_a_id, rule_b_id, evidence, status; index on (user_id, status)

**API (app/api/rules/route.ts):**
- GET: returns all user rules ordered by fires desc; dormancy computed server-side — rules with last_fired_at null or older than 60 days return status='dormant'
- POST: Zod validation → 20-rule hard cap per prefilter_bucket (422 CAP_EXCEEDED) → token-Jaccard redundancy check >= 0.85 (409 conflictsWith) → create

**UI (app/(app)/rules/page.tsx):**
- Client component matching design prototype exactly: cx-rules outer, cx-tabrow with All/Active/Dormant tabs + counts, cx-rules-list ol, cx-rule cx-rule-{status} li items with cx-rule-head / cx-rule-text code / cx-rule-foot
- useQuery with 30s refetch interval

**Cron (app/api/rules/consolidation/cron/route.ts):**
- POST with CRON_SECRET Bearer auth
- Groups active rules by user_id + prefilter_bucket, runs tokenJaccard pairwise
- Creates RuleConsolidationProposal rows for pairs >= 0.80 similarity not already pending
- Never auto-merges (RUL-04 compliance)
- vercel.json: `0 4 * * 0` (Sunday 04:00 UTC)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data flows from live Neon DB through /api/rules.

## Threat Surface

Mitigations from threat model applied:
- T-03-04-01: requireAuth() + Zod on POST; all writes scoped to userId
- T-03-04-03: CRON_SECRET Bearer check on consolidation cron POST

## Self-Check: PASSED

All created files exist on disk. Both task commits verified in git log.
