# Roadmap: Cortex

## Overview

Cortex evolves across milestones. **v1.0** stood up the full vertical: ingest → classify → triage → taxonomy → rules → retrieval, end-to-end (Phases 1–4, all complete). **v1.1** is a brownfield rewire of the ingest backbone — daemon becomes a thin metadata client, Neon access funnels through the Vercel API guarded by `CORTEX_API_KEY`, classification moves to queue-driven consumers that pass file paths (not content) to `claude -p`. v1.1 is invisible to the user-facing surfaces; it makes the pipeline reliable enough to run unattended.

---

## Milestone v1.0 — Initial Build (Shipped 2026-04-24)

### Phases (v1.0)

- [x] **Phase 1: Foundation** - Neon schema, Mac daemon, two-stage classification pipeline, Drive _Inbox upload, Langfuse instrumentation (completed 2026-04-24)
- [x] **Phase 2: Triage & Web App** - Clerk auth, archival design system, keyboard-first triage queue, Drive resolve cron (completed 2026-04-24)
- [x] **Phase 3: Taxonomy, Rules & Admin** - Taxonomy ops (rename/merge/split/deprecate), rule system, /admin metrics (completed 2026-04-24)
- [x] **Phase 4: Retrieval** - Embedding cron, pgvector HNSW index, /api/ask with Claude Haiku synthesis and inline citations (completed 2026-04-24)

### Phase Details (v1.0)

### Phase 1: Foundation
**Goal**: Items flow from Downloads and Gmail through a two-stage classification pipeline into Neon and Drive _Inbox, with full traces and triage metrics instrumented from day one
**Depends on**: Nothing (first phase)
**Requirements**: ING-01, ING-02, ING-03, ING-04, ING-05, ING-06, CLS-01, CLS-02, CLS-03, CLS-04, CLS-05, CLS-06, CLS-07, CLS-08, DRV-01, OBS-01, OBS-06
**Success Criteria** (what must be TRUE):
  1. A file dropped in ~/Downloads appears in Neon within 60 seconds with a classification trace (both stage outputs, confidence scores, rule matches)
  2. A new Gmail message appears in Neon within one poll cycle; historyId 404 triggers a full-sync fallback logged to Langfuse
  3. A duplicate file (same SHA-256) dropped twice results in exactly one Neon row and one Drive upload
  4. A keep-classified item has a Drive blob at _Inbox/{YYYY-MM}/{name}; an ignore-classified item has only a minimal Neon row
  5. uncertain_rate and auto_filed_rate metrics are readable from Neon from day one; daemon heartbeat events appear in Langfuse every 5 minutes
**Plans**: 6 plans

Plans:
- [x] 01-01-PLAN.md — Neon schema (all models + irreversible columns) + agent ESM package + db push
- [x] 01-02-PLAN.md — Downloads FSEvents collector + polling fallback + daemon heartbeat + launchd plist
- [x] 01-03-PLAN.md — Gmail incremental sync + historyId 404 fallback + Google OAuth keytar storage
- [x] 01-04-PLAN.md — SHA-256 dedup + size-band extractor + Stage 1 relevance gate (keep/ignore/uncertain)
- [x] 01-05-PLAN.md — Stage 2 label classifier (3-axis + confidence) + Drive _Inbox upload
- [x] 01-06-PLAN.md — Langfuse trace IDs on Item rows + daily MetricSnapshot (uncertain_rate, auto_filed_rate)

### Phase 2: Triage & Web App
**Goal**: Daniel can authenticate, open the triage queue, keyboard-navigate uncertain items, make relevance and label decisions, and see Drive blobs move from _Inbox to classified paths
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, TRI-01, TRI-02, TRI-03, TRI-04, TRI-05, TRI-06, TRI-07, TRI-08, TRI-09, TRI-10, DRV-02, DRV-03, DRV-04, DRV-05, DSN-01, DSN-02, DSN-03, DSN-04, DSN-05, OBS-05
**Success Criteria** (what must be TRUE):
  1. Daniel logs in with Clerk MFA and the web app is the only entry point; user-initiated delete removes Drive blob, Neon rows, and embeddings atomically
  2. The triage queue renders in the archival aesthetic (Newsreader/Inter Tight/JetBrains Mono, ivory/ink/umber palette) matching the Claude Design handoff pixel-faithfully
  3. Keyboard shortcuts K/X/S (relevance mode) and 1/2/3/N/S/Enter/A/I (label mode) with J/H navigation and U undo all work without mouse; each decision completes in under 3 seconds once taxonomy matures
  4. After a label decision is confirmed, the Drive blob moves from _Inbox to proposed_drive_path within the cron window; collision appends a short hash suffix; cascade moves are tracked per-item (not fire-and-forget)
  5. The metrics strip shows 6 cells with north star + 5 leading indicators on every page load
**Plans**: 5 plans

Plans:
- [x] 02-01-PLAN.md — Clerk middleware + globals.css design system + root layout + Prisma client
- [x] 02-02-PLAN.md — App shell (Sidebar + Topbar + MetricsStrip) + /api/metrics
- [x] 02-03-PLAN.md — Triage queue (TriageView + all keyboard shortcuts + API)
- [x] 02-04-PLAN.md — Drive resolve cron + delete API + schema resolve_error column
- [x] 02-05-PLAN.md — Integration wiring + dark mode + visual checkpoint

### Phase 3: Taxonomy, Rules & Admin
**Goal**: Daniel can rename, merge, split, and deprecate taxonomy categories with cascading Drive moves; create and manage rules that pre-filter classification; and view the /admin metrics that validate the feedback loop hypothesis
**Depends on**: Phase 2
**Requirements**: TAX-01, TAX-02, TAX-03, TAX-04, TAX-05, TAX-06, TAX-07, RUL-01, RUL-02, RUL-03, RUL-04, RUL-05, RUL-06, OBS-02, OBS-03, OBS-04
**Success Criteria** (what must be TRUE):
  1. Renaming a taxonomy category propagates to all item assignments, rules, and Drive paths atomically; the merge operation remaps 2+ categories to a canonical with an audit row; split and deprecate are available and leave historical assignments intact
  2. A new label creation is blocked or redirected if a fuzzy-match against existing taxonomy exceeds 0.85 similarity; the entity merge proposal inbox surfaces nightly proposals with side-by-side evidence
  3. Rules are structured predicates, capped at 20 per classification prompt, with redundancy check on write; dormant rules (60-day zero-fire) surface for deprecation review; re-apply with preview diff is available
  4. /admin page shows queue depths, auto-decision rates, rule count, median rules-in-context, dormant-rule ratio, retrieval latency, and weekly pulse score
**Plans**: 6 plans

Plans:
- [x] 03-01-PLAN.md — TaxonomyMergeProposal schema + GET /api/taxonomy + TaxonomyView page (three-tab list + merge sidebar)
- [x] 03-02-PLAN.md — Taxonomy mutations: rename/merge/split/deprecate APIs + wired action modals
- [x] 03-03-PLAN.md — Fuzzy dedup gate (0.85 block) + nightly merge proposal cron
- [x] 03-04-PLAN.md — Rule schema + GET/POST /api/rules (hard cap + redundancy check) + RulesView page + weekly consolidation cron
- [x] 03-05-PLAN.md — Rule re-apply: two-phase PATCH (preview diff + confirm) + edit panel in RulesView
- [x] 03-06-PLAN.md — AdminView page + extended /api/metrics (dormantRatio, medianRulesInCtx, queueTrend) + MetricsStrip wiring + human checkpoint

### Phase 4: Retrieval
**Goal**: Daniel can ask a natural-language question and receive a synthesized answer with inline citations linking to the source items in Drive
**Depends on**: Phase 3
**Requirements**: RET-01, RET-02, RET-03, RET-04, RET-05
**Success Criteria** (what must be TRUE):
  1. Filed items have embeddings generated by a background cron job (OpenAI text-embedding-3-small, 512d halfvec); uncertain and ignored items are never embedded
  2. /api/ask returns a Claude Haiku-synthesized answer with up to 5 numbered citation badges that are clickable and link to Drive paths
  3. The Ask UI renders a serif input, answer body with inline citation badges, and a sources list with Drive paths — Claude is the only retrieval surface (no manual search bar)
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — embedTexts helper + POST /api/cron/embed (filed-only, batch 50) + HNSW migration
- [x] 04-02-PLAN.md — POST /api/ask (embed query → ANN → Haiku synthesis → AskResponse)
- [x] 04-03-PLAN.md — AskPage (/ask) pixel-faithful to design prototype + citedAnswers in /api/metrics + human checkpoint

---

## Milestone v1.1 — Ingest Pipeline Rearchitecture (Active)

Restore backend isolation and make the ingest pipeline reliable. Daemon stops touching Neon, classification moves to queue-driven consumers, and `claude -p` switches from argv content to file paths. v1.1 is a backend-only milestone — no UI, triage, taxonomy, rules, admin, ask, or Drive-upload changes.

### Phases (v1.1)

- [x] **Phase 5: Queue & API Surface** - Additive `Item.status` enum + ingest/queue/classify routes + `CORTEX_API_KEY` middleware + atomic claim semantics + retry/stale-claim handling (completed 2026-04-25)
- [x] **Phase 6: Daemon Thin Client** - Daemon refactor: drops `DATABASE_URL`, POSTs to `/api/ingest`, applies new scan rules (skip `.git`/`node_modules` trees, skip hidden files), no classification or Drive uploads (completed 2026-04-25)
- [ ] **Phase 7: Stage 1 & Stage 2 Consumers** - Two separate local processes polling `/api/queue`, invoking `claude -p` with file paths (Downloads) or text prompts (Gmail), POSTing results to `/api/classify` with Langfuse traces
- [ ] **Phase 8: Operational Acceptance** - End-to-end validation: 1h zero-error daemon run on Downloads+Documents, Gmail 6-month backfill completes, runtime audits confirm no `DATABASE_URL` in daemon env and no file content in consumer argv

### Phase Details (v1.1)

### Phase 5: Queue & API Surface
**Goal**: The Vercel API exposes a complete, authenticated ingest/queue/classify contract with an extended `Item.status` state machine that supports atomic claim, retry-on-failure, and stale-claim reclamation — all existing routes continue to work unchanged
**Depends on**: Phase 4 (v1.0 retrieval shipped)
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, QUE-01, QUE-02, QUE-03, QUE-04, QUE-05, QUE-06
**Success Criteria** (what must be TRUE):
  1. POSTing file or email metadata to `/api/ingest` with a valid `CORTEX_API_KEY` either creates a new Item with `status = pending_stage1` or returns the existing item id on SHA-256 dedup hit; without the key the request returns 401 and no Item data leaks
  2. `GET /api/queue?stage=1&limit=N` and `GET /api/queue?stage=2&limit=N` each return up to N pending items and atomically transition them to the matching `processing_*` status — two parallel callers never receive the same item id
  3. `POST /api/classify` with a Stage 1 result advances the Item to `pending_stage2` (keep), `ignored` (ignore), or `uncertain`; with a Stage 2 result advances to `certain` or `uncertain`; an item that fails retries up to a hard cap and then lands in a terminal error state, never bouncing back to pending forever
  4. An item left in `processing_stage1` or `processing_stage2` past the stale-claim timeout is reclaimed to its `pending_*` state on the next queue poll, and the queue invariant holds: no item that entered `/api/ingest` ends a run stuck in `processing_*`
  5. Existing routes (`/api/triage`, `/api/taxonomy`, `/api/rules`, `/api/ask`, `/api/admin/*`, `/api/cron/*`) and the Drive resolve cron return the same responses they did at v1.0 close — no regressions in the v1.0 surfaces
**Plans**: 3 plans

Plans:
- [ ] 05-01-PLAN.md — Auth helper, queue-config constants, atomic-claim SQL helpers + tests (foundation lib)
- [ ] 05-02-PLAN.md — POST /api/ingest (dedup → pending_stage1) + POST /api/classify (state machine, retry-cap-to-error)
- [ ] 05-03-PLAN.md — GET /api/queue (FOR UPDATE SKIP LOCKED claim, stale + legacy reclaim) + API-06 regression smoke test

### Phase 6: Daemon Thin Client
**Goal**: The Mac daemon is a thin metadata producer with no Neon access, no classification responsibility, and no Drive uploads — it discovers files via chokidar + recursive scan, polls Gmail incrementally, applies the new directory scan rules, and POSTs every discovery to `/api/ingest` over `CORTEX_API_KEY`
**Depends on**: Phase 5
**Requirements**: DAEMON-01, DAEMON-02, DAEMON-03, DAEMON-04, DAEMON-05, DAEMON-06, SCAN-01, SCAN-02, SCAN-03
**Success Criteria** (what must be TRUE):
  1. The daemon process environment contains `CORTEX_API_URL`, `CORTEX_API_KEY`, `WATCH_PATHS`, Google OAuth credentials, and Langfuse keys — and nothing else; specifically `DATABASE_URL` is absent and the daemon process exposes no Prisma client
  2. A new file landing under any path in `WATCH_PATHS` (or surfaced by the startup recursive scan) results in a `POST /api/ingest` call within seconds, authenticated with `CORTEX_API_KEY`; a new Gmail message surfaced via incremental historyId polling produces an analogous POST with subject, from, snippet, and headers
  3. A directory tree containing a `.git` or `node_modules` entry at any level is skipped entirely — no file inside a repo or `node_modules` is ever enqueued; hidden files (`.DS_Store`, dotfiles) are likewise never enqueued; subdirectory recursion is unbounded otherwise
  4. The daemon performs no classification calls and no Drive API uploads — Stage 1, Stage 2, and the Drive resolve cron remain the sole owners of those responsibilities; daemon code paths to `claude -p` and to Drive uploads no longer exist
**Plans**: 2 plans

Plans:
- [ ] 06-01-PLAN.md — HTTP client + FIFO buffer + heartbeat extension on /api/ingest
- [ ] 06-02-PLAN.md — Daemon refactor (delete v1.0 db/drive/pipeline; rewrite collectors/scan/heartbeat/index) + plist + package.json cleanup

### Phase 7: Stage 1 & Stage 2 Consumers
**Goal**: Two separate local consumer processes drain the queue end-to-end — Stage 1 polls relevance with up to 10 concurrent classifications, Stage 2 polls labelling with up to 2 concurrent classifications, both invoke `claude -p` with file paths (or text prompts for Gmail) and POST results back, with Langfuse traces spanning the full daemon → API → consumer → API loop for every item
**Depends on**: Phase 6
**Requirements**: CONS-01, CONS-02, CONS-03, CONS-04, CONS-05, CONS-06
**Success Criteria** (what must be TRUE):
  1. The Stage 1 consumer is a separate process that polls `GET /api/queue?stage=1&limit=10`, runs up to 10 concurrent `claude -p` invocations, and POSTs each result to `/api/classify`; the Stage 2 consumer is its own process polling `?stage=2&limit=2` with up to 2 concurrent invocations
  2. For a file item (binary or text), the consumer's `claude -p` invocation contains the absolute file path in the prompt and instructs Claude to read it — the file's bytes are never present in argv; binary files, files with null bytes, and large files (PDFs, images, installers within size bands) classify without EBADF, EMFILE, or argv-size errors
  3. For a Gmail item, the consumer builds a text prompt from subject / from / snippet / headers (no file path); Stage 2 receives the existing taxonomy as additional context so it can propose 3-axis labels and a Drive path
  4. Gmail "keep" items reliably advance from Stage 1 (`pending_stage1` → `processing_stage1` → `pending_stage2`) into Stage 2 (`processing_stage2` → `certain`/`uncertain`) without manual intervention — the v1.0 bug where keeps remained at `processing` forever no longer reproduces
  5. Every classification emits a Langfuse trace covering its end-to-end work, and POSTs to `/api/classify` carry decision, confidence, axes/labels, and proposed Drive path where applicable
**Plans**: 2 plans (estimated)

### Phase 8: Operational Acceptance
**Goal**: The rearchitected pipeline runs unattended for the published soak periods with zero errors, every operational invariant from the brief is independently auditable, and end-to-end traceability from daemon discovery to consumer classify is reconstructable in Langfuse — v1.1 is shippable
**Depends on**: Phase 7
**Requirements**: ACC-01, ACC-02, ACC-03, ACC-04, ACC-05
**Success Criteria** (what must be TRUE):
  1. The daemon scans `~/Downloads` + `~/Documents` continuously for one wall-clock hour with zero errors logged to its stderr or to Langfuse — the run log is captured and reviewable
  2. A Gmail 6-month backfill completes without hanging — every message in the window either ingests successfully (Item row exists with `status` in `{pending_stage1, processing_*, pending_stage2, certain, uncertain, ignored}`) or has an explicit rejection record; no message is left in an indeterminate state
  3. Items dropped via the Downloads or Gmail collectors during the soak period flow through Stage 1 and Stage 2 and surface in the existing v1.0 triage UI for any operator review needed — no manual queue intervention is required at any step
  4. A runtime audit (`launchctl print` or equivalent) of the daemon process confirms `DATABASE_URL` is not in its environment; a runtime audit of consumer subprocess argv (captured via `ps -ww` or equivalent during a live Stage 1/2 run) confirms file content is never present in any `claude -p` argument
  5. A single ingested item can be reconstructed end-to-end in the Langfuse dashboard from daemon ingest POST → API row write → consumer queue claim → `claude -p` invocation → API classify POST, with linked spans across the daemon, API, and consumer processes
**Plans**: 1 plan (estimated)

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 6/6 | Complete    | 2026-04-24 |
| 2. Triage & Web App | 5/5 | Complete    | 2026-04-24 |
| 3. Taxonomy, Rules & Admin | 6/6 | Complete    | 2026-04-24 |
| 4. Retrieval | 3/3 | Complete    | 2026-04-24 |
| 5. Queue & API Surface | 3/3 | Complete    | 2026-04-25 |
| 6. Daemon Thin Client | 2/2 | Complete    | 2026-04-25 |
| 7. Stage 1 & Stage 2 Consumers | 0/2 | Not started | - |
| 8. Operational Acceptance | 0/1 | Not started | - |
