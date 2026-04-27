# Quick Task 260427-tlk: Base-taxonomy seed + feedback-loop bug fixes — Summary

**Completed:** 2026-04-27
**Commits:** c291311 (triage fix + partial seed), 42520f6 (build fix + apply scripts)

## What shipped

### Bug fixes in `/api/triage` confirm branch

Two bugs in the human-feedback loop, both fixed in the same handler:

**Bug #1 — TaxonomyLabel wasn't growing.** Confirming an item via the
triage UI wrote `axis_*` to the Item but never upserted `TaxonomyLabel`
rows. After 370 items + many manual confirmations, the table stayed
empty → Stage 2 prompts always saw "(none yet)" for axes → Claude
classified each item independently with no shared vocabulary.

**Bug #2 — Items never reached `status='filed'`.** Confirm wrote
`status='certain'`, which means "Stage 2 was confident" — not "human
confirmed and filed." Plus the route never copied
`proposed_drive_path → confirmed_drive_path`. The h9w cold-start gate
queries `WHERE status='filed' AND confirmed_drive_path IS NOT NULL`,
which was permanently 0 → auto-file never fired.

**Fix** (one prisma transaction):
- `status='filed'` (terminal post-confirmation)
- carry `proposed_drive_path → confirmed_drive_path` if the latter is null
- upsert TaxonomyLabel rows for each picked axis (item_count++, last_used touched)

Verified end-to-end at the data layer via `scripts/smoke-triage-fix.ts`:
synthetic uncertain item → confirm → status=filed, axes locked, path
carried, TaxonomyLabel counts went 0→1.

### Base-taxonomy seed (intent-driven archive)

Designed from first principles for a multi-jurisdictional individual
operating two business entities. **The user's existing folder layout
was deliberately ignored** in favor of a professional archive structure.

**Architecture** (full doc: `SEED-v3-architecture.md`):
- Provenance > function > time
- `/business/{fonnit,terradan-colombia,terradan-dubai}/` with parallel
  per-entity buckets (`invoices-in/{year}/{month}/`,
  `invoices-out/{year}/{month}/`, `bank-statements/{year}/`,
  `tax-filings/{year}/`, `corporate/`, `contracts/`)
- `/personal/finance/{payslips,bank-statements}/{employer-or-bank}/{year}/`
- `/identity/{passport,residence-permit,national-ids,civil-registry}/`
  (self only — Daniel + Jenny)
- `/family/civil-registry/` (everyone else)
- `/travel/{year}/{location}/`
- `/employment/{employer}/{contracts,correspondence,certifications}/`

**Seeding strategy** — multi-pass:

1. **Three parallel agents** analyzed `~/Documents` (809 files),
   `~/Downloads` (2284 files), and the subdirectory hierarchy (174
   subdirs) to surface candidate axes + folders + sample mappings.
2. **Synthesizer** (`scripts/synthesize-seed-v2.ts`) merged outputs +
   deduped axis values + applied intent-driven repathing.
3. **Apply pass** (`scripts/apply-seed.ts`) inserted 88 TaxonomyLabel
   rows + 42 anchor Items (date-agnostic folders).
4. **Content-pass agent** opened invoice / payslip / bank-statement
   PDFs <1MB, extracted real dates + senders via pdftotext, emitted
   249 enriched anchors.
5. **Apply content-pass** (`scripts/apply-content-pass.ts`) inserted
   232 + updated 17, bringing total to **277 filed Items / 38 stable
   folders** (≥3 anchors each — h9w auto-file gate satisfied).

### Other code changes

- `agent/src/consumer/claude.ts` — scrubs `ANTHROPIC_API_KEY`,
  `CLAUDE_API_KEY`, `ANTHROPIC_AUTH_TOKEN` from the env passed to
  `claude -p`. The keys live in `.env.local` for the Vercel API's SDK
  clients but were leaking to the CLI subprocess, forcing API-credit
  billing instead of the Code subscription.
- `agent/src/collectors/downloads.ts` — exported `buildPayload`,
  `sha256OfFile`, `inferMimeType` so one-shot scripts reuse the same
  ingest payload shape as the daemon (no service-layer duplication).
- `tsconfig.json` — excluded `scripts/` (standalone tsx Node scripts,
  not part of the Next.js app build).

## End-to-end smoke test

Ran `process-files.ts` on 8 fresh FonnIT-2024 vendor invoices
(Trello, 1Password, Google, Sorted) NOT previously in the DB.
Result:

| status | count | what it means |
|---|---|---|
| `filed` | 2 | Auto-file gate fired — h9w's parent-≥3-siblings + path_confidence ≥0.85 + all axes ≥0.85 met |
| `certain` | 3 | Right path proposed, axis confidence between 0.75–0.85 (Claude flagging for human review — including one new axis label `invoice-incoming`) |
| `uncertain` | 3 | Right path proposed, ≥1 axis below 0.75 |

**Every one** of the 8 landed in the seeded archive structure. No
"30 different folders" problem. Date extraction worked even where
filenames had no year (`4903135957_Google.pdf` → 2024/01).

When the user confirms the 3 uncertain + 3 certain items via the
triage UI (post bug-fix), TaxonomyLabel will grow, those folders
will gain anchors, and future similar items auto-file. That's the
feedback loop working.

## Files added

```
.planning/quick/260427-tlk-base-taxonomy-seed/
├── 260427-tlk-SUMMARY.md          (this file)
├── SEED.md                        (v1 — initial 3-agent synthesis)
├── SEED-v2.md                     (v2 — intent-driven, deduped)
├── SEED-v3-architecture.md        (v3 — final professional archive design)
├── cortex-seed.json               (v1 machine-readable)
└── cortex-seed-v2.json            (v2 machine-readable)

scripts/
├── apply-seed.ts                  (partial seed — date-agnostic folders)
├── apply-content-pass.ts          (content-pass anchors with real dates)
├── process-files.ts               (manual ingest pipeline driver)
├── reset-db.ts                    (wipe runtime tables, preserve user setup)
├── pick-fresh-candidates.ts       (find files not yet in DB)
├── smoke-triage-fix.ts            (data-layer verification of bug fixes)
├── synthesize-seed.ts             (v1 synthesizer)
└── synthesize-seed-v2.ts          (v2 synthesizer)
```

## State after this task

- `TaxonomyLabel`: ~88 canonical labels seeded + grown by 32 distinct
  values from the content-pass anchors
- `Item` (filed): 277 across 90 parent dirs; 38 stable (≥3 anchors)
- `IdentityProfile`, `Rule`: untouched (preserved during reset)

## Out of scope (deferred)

1. **Bug #29** — drop Stage 1, route ≥1MB files directly to triage.
   Architectural change. Logged as pending task.
2. **Bug #30** — triage UI should not propose folder paths.
   Architectural change. Logged as pending task.
3. **Drive upload** — `drive_inbox_id` is never set; `cron/resolve`
   never runs the actual file move. Items reach `filed` with virtual
   paths only. Drive sync is v1.2+ work.
4. **Castlabs payslip 2021 PDF** — image-only (no text layer); the
   content-pass agent skipped it. Manual triage will handle.
5. **Top-level seed for `/utilities/`** — collapsed into
   `/personal/finance/invoices/{year}/{month}/` per user preference.
   Future utility bills (Ostrom, DuesselFibre) will land there.

## Next steps when convenient

- Replace Stage 1 + triage path-proposal architecture per pending bugs
  #29/#30. Both are ~1 quick task each.
- Add a Drive upload phase (or descope `drive_inbox_id` from
  `cron/resolve` permanently).
- Bootstrap daemon + consumer to start processing real-time ingestion
  against the new seeded structure.
