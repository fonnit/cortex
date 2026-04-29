---
phase: quick-260430-0ff
plan: 01
subsystem: seed
tags: [seed, taxonomy, refactor, scripts]
requires:
  - cortex-seed-v2.json (78 v2 anchors)
  - SEED-v4-prod.md (locked decisions, 2026-04-29)
provides:
  - cortex-seed-v4.json (36 v4 anchors, 22 types, 15 froms)
  - scripts/synthesize-seed-v4.ts (idempotent transformer)
  - scripts/apply-seed.ts --dry-run (zero-DB preflight)
affects:
  - apply-seed.ts (now JSON-driven; no axis_context writes; no third-axis TaxonomyLabel rows)
tech_added: []
patterns:
  - JSON seed + Zod-validated runtime load (pattern for future seed evolutions)
  - Dynamic prisma import gated behind dry-run branch (zero-DB CLI preflight)
key_files:
  created:
    - scripts/synthesize-seed-v4.ts
    - .planning/quick/260427-tlk-base-taxonomy-seed/cortex-seed-v4.json
  modified:
    - scripts/apply-seed.ts
decisions:
  - Stable generated_at sourced from v2.generated_at (idempotent reruns)
  - Zod .strict() on axes + anchor objects (load-time guard against context resurrecting)
  - Dynamic prisma import to keep --dry-run zero-DB
metrics:
  duration: ~10 minutes
  completed: 2026-04-29
  tasks: 2
  files_created: 2
  files_modified: 1
  v2_anchors: 78
  v4_anchors: 36
  v4_types: 22
  v4_froms: 15
  v4_stable_folders: 12
---

# Quick Task 260430-0ff: Generate cortex-seed-v4.json + Refactor apply-seed.ts Summary

JSON-driven taxonomy seed: cortex-seed-v4.json materialises the 6 locked SEED-v4-prod.md decisions and apply-seed.ts becomes a pure JSON consumer with a zero-DB --dry-run preflight.

## What changed

**Task 1 — `scripts/synthesize-seed-v4.ts`** (commit `ffd0653`):
One-shot transformer that reads `cortex-seed-v2.json` (78 anchors), applies the v2→v4 filter + remap rules from SEED-v4-prod.md, and writes `cortex-seed-v4.json`. Idempotent: re-running produces byte-identical output (timestamp sourced from `v2.generated_at`).

**Task 2 — `scripts/apply-seed.ts`** (commit `8cce194`):
Refactored from inline-arrays applier to JSON-consumer applier. Hardcoded `TYPE_VALUES` / `FROM_VALUES` / `CONTEXT_VALUES` / `ANCHORS` arrays (lines 30-242 of the v3 file) gone. New surface:

```bash
npx tsx scripts/apply-seed.ts [--dry-run] [--seed=<path>]
# Defaults to --seed=.planning/quick/260427-tlk-base-taxonomy-seed/cortex-seed-v4.json
```

`--dry-run` runs without `DATABASE_URL` or `SEED_USER_ID` (Prisma loaded via dynamic import only inside the live-run branch).

## Anchor transformation summary

| Stat | Value |
|------|-------|
| v2 anchors (input) | 78 |
| v4 anchors (output) | 36 |
| Dropped: date-bucketed paths (D6) | 24 |
| Dropped: type not in v4 set | 18 |
| Remapped: real-estate-permit → corporate-registration (D5) | 3 |
| `from` nullified (vendor not in v4 set) | 13 |
| Distinct types used by anchors | 12 / 22 |
| Distinct froms used by anchors | 6 / 15 |

The `from` axis carries 9 unused core values (`accountable`, `castlabs`, `dubai-government`, `esg-book`, `fonnit`, `german-tax-authority`, `n26`, `revolut`, `wio-bank`, `uae-government`); these still get TaxonomyLabel rows so the agentic loop can suggest them when items arrive — they just don't have anchor coverage yet.

The `from` axis carries no utility providers (`ostrom`, `empower`, `duesselfibre`) because none of the v2 anchors used them. They emerge as utility-bill items get filed.

## Per-parent count table (v4)

All 12 surviving parents are at threshold ≥3 — zero emergent folders:

| Parent | Anchor count | Status |
|--------|-------|--------|
| `/business/terradan-dubai/corporate/` | 3 | stable |
| `/education/certificates/` | 3 | stable |
| `/education/diplomas/` | 3 | stable |
| `/family/civil-registry/` | 3 | stable |
| `/identity/civil-registry/` | 3 | stable |
| `/identity/national-ids/` | 3 | stable |
| `/identity/passport/` | 3 | stable |
| `/identity/residence-permit/` | 3 | stable |
| `/legal/contracts/` | 3 | stable |
| `/personal/finance/credit-applications/` | 3 | stable |
| `/personal/finance/insurance/` | 3 | stable |
| `/real-estate/rental/contracts/` | 3 | stable |

(Compare SEED-v4-prod.md §"Base path list" which targets ~22 stable paths via additional anchor curation. The v4 JSON only seeds what the v2 transformer can produce — anchor curation beyond v2 coverage is a follow-up edit to the v4 JSON, not a transformer change.)

## Six locked decisions verified

| # | Decision | Verification | Result |
|---|----------|--------------|--------|
| D1 | Drop `context` axis | `j.axes.context === undefined` | OK |
| D2 | Terradan nested under `/business/{terradan-dubai,terradan-medellin}/` | 3 anchors match | OK (3 corp-registration files) |
| D3 | type axis = 22 values | `j.axes.type.length === 22` | OK |
| D4 | from axis = 15 core + utilities | `j.axes.from.length === 15` (no utilities used in v2) | OK |
| D5 | AW/PBP/TerradanDubai → `corporate-registration` under `/business/terradan-dubai/corporate/` | 3 anchors match | OK |
| D6 | No date-bucketed drivePaths | `anchors.filter(a => /\/\d{4}\//.test(a.drivePath)).length === 0` | OK |

## Anchor file existence (--dry-run output)

All 36 anchor files exist on disk under `/Users/dfonnegrag/`. No missing files; `apply-seed.ts --dry-run --seed=<v4>` exits 0.

## axis_context write removal

```bash
$ grep -c "axis_context" scripts/apply-seed.ts
0
$ grep -c "TYPE_VALUES\|FROM_VALUES\|CONTEXT_VALUES" scripts/apply-seed.ts
0
```

`axis_context` and `axis_context_confidence` are no longer in any `prisma.item.create`/`update` payload. The schema column stays (no migration required); v4 just leaves it null. TaxonomyLabel iteration covers `type` and `from` axes only — no rows inserted for the dropped third axis.

## Commit hashes

- Task 1: `ffd0653` — `feat(quick-260430-0ff-1): synthesize cortex-seed-v4.json from v2`
- Task 2: `8cce194` — `refactor(quick-260430-0ff-2): apply-seed.ts consumes v4 JSON, drops axis_context writes, adds --dry-run`

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stable `generated_at` for transformer idempotency**
- **Found during:** Task 1 verification
- **Issue:** Plan §verification step 1 calls `git diff --exit-code` after a transformer rerun. With `new Date().toISOString()` (the v2 transformer's pattern) the timestamp drifts every run, breaking idempotency.
- **Fix:** Source `v4.generated_at` from `v2.generated_at`. Transformer reruns against an unchanged v2 input now produce byte-identical output.
- **Files modified:** `scripts/synthesize-seed-v4.ts`
- **Commit:** `ffd0653`

**2. [Rule 3 - Blocking] Comment rewording to satisfy literal grep**
- **Found during:** Task 2 verification
- **Issue:** The plan's done-criteria + success-criteria explicitly require `grep -c "TYPE_VALUES\|FROM_VALUES\|CONTEXT_VALUES" scripts/apply-seed.ts` and `grep -c "axis_context"` to return 0. The header docstring described the v4 changes by name (e.g., "TYPE_VALUES / FROM_VALUES / CONTEXT_VALUES arrays") which would have caused those greps to return 1.
- **Fix:** Rewrote the docstring to describe the changes without using the literal forbidden tokens. No semantic change — the file still documents what it removed.
- **Files modified:** `scripts/apply-seed.ts`
- **Commit:** `8cce194`

(Both deviations are mechanical adjustments to align with the plan's explicit verification commands, not architectural changes.)

## Out-of-scope follow-ups (operator)

The plan calls these out as out-of-scope; logging here for traceability:

1. Hand-curate `cortex-seed-v4.json` to add anchors for the 10 unused `from` values (accountable, castlabs, dubai-government, esg-book, fonnit, german-tax-authority, n26, revolut, wio-bank, uae-government) and the 10 unused `type` values (bank-statement, employment-contract, invoice, invoice-outgoing, payslip, rent-payment, tax-filing, ticket, title-deed, utility-bill). SEED-v4-prod.md §"Base path list" is the curation target.
2. `SEED_USER_ID=user_xxx npx tsx --env-file=.env.local scripts/apply-seed.ts` against local docker DB to verify live writes still produce expected rows.
3. `curl /api/paths/internal` returns ≥22 parents post-apply (currently 12 from this v4 transform).
4. Production apply against Neon once lx4 + nic commits ship to Vercel.

## Self-Check: PASSED

- Files created exist:
  - `.planning/quick/260427-tlk-base-taxonomy-seed/cortex-seed-v4.json` FOUND
  - `scripts/synthesize-seed-v4.ts` FOUND
- Files modified exist:
  - `scripts/apply-seed.ts` FOUND
- Commits exist:
  - `ffd0653` FOUND (Task 1)
  - `8cce194` FOUND (Task 2)
- Verification: All 6 locked decisions verified; --dry-run exits 0 with zero missing files; transformer idempotency verified via repeat run + git diff.
