# Requirements: Cortex

**Defined:** 2026-04-24
**Updated:** 2026-04-25 (milestone v1.1 defined)
**Core Value:** The triage feedback loop compounds fast enough that weekly triage load trends down — Cortex learns to file so Daniel doesn't have to.

## v1.1 Requirements (Active — Ingest Pipeline Rearchitecture)

Restore backend isolation, fix `claude -p` content passing, and replace inline scan classification with a queue-driven consumer model. No changes to UI / triage / taxonomy / rules / admin / ask surfaces.

### Daemon (thin client)

- [ ] **DAEMON-01**: Daemon does not access Neon directly — `DATABASE_URL` is absent from the daemon's runtime environment
- [ ] **DAEMON-02**: Daemon discovers files via chokidar + a startup recursive scan of `WATCH_PATHS` and POSTs metadata (file path, source, content hash) to `POST /api/ingest`
- [ ] **DAEMON-03**: Daemon polls Gmail incrementally (historyId) and POSTs message metadata (gmail_id, subject, from, snippet, headers) to `POST /api/ingest`
- [ ] **DAEMON-04**: Daemon authenticates every API call with the `CORTEX_API_KEY` shared secret in an `Authorization` header
- [ ] **DAEMON-05**: Daemon performs no classification and no Drive uploads — those responsibilities move to the Stage 1/2 consumers and the Drive resolve cron
- [ ] **DAEMON-06**: Daemon environment surface is `CORTEX_API_URL`, `CORTEX_API_KEY`, `WATCH_PATHS`, Google OAuth credentials, and Langfuse — nothing else

### API (ingest / queue / classify)

- [ ] **API-01**: `POST /api/ingest` accepts file or email metadata, performs SHA-256 dedup against existing Items, and writes a new Item row with `status = pending_stage1` (or returns 200 with the existing item id on dedup hit)
- [ ] **API-02**: `GET /api/queue?stage=1&limit=N` returns up to N items where `status = pending_stage1`, atomically marking them `processing_stage1` (FOR UPDATE SKIP LOCKED or equivalent) so no two consumers pick the same item
- [ ] **API-03**: `GET /api/queue?stage=2&limit=N` returns up to N items where `status = pending_stage2`, atomically marking them `processing_stage2`
- [ ] **API-04**: `POST /api/classify` accepts a stage-tagged classification result, validates it, updates the Item row, and advances `status` according to the queue state machine (Stage 1 keep → `pending_stage2`; Stage 1 ignore → `ignored`; Stage 1 uncertain → `uncertain`; Stage 2 outcome → `certain` or `uncertain`)
- [ ] **API-05**: API middleware validates `CORTEX_API_KEY` on `/api/ingest`, `/api/queue`, and `/api/classify`; missing or invalid keys return 401 and never leak Item data
- [ ] **API-06**: All existing API routes (`/api/triage`, `/api/taxonomy`, `/api/rules`, `/api/ask`, `/api/admin/*`, `/api/cron/*`) and the Drive resolve cron continue to work unchanged

### Queue state machine

- [ ] **QUE-01**: `Item.status` enum is extended (additive only — no breaking schema changes) with `pending_stage1`, `processing_stage1`, `pending_stage2`, `processing_stage2`; existing values (`certain`, `uncertain`, `ignored`) are preserved
- [ ] **QUE-02**: `pending_*` → `processing_*` transitions are atomic and serialized so two consumer instances cannot claim the same item
- [ ] **QUE-03**: A failed Stage 1 classification returns the item to `pending_stage1` and increments a retry counter; after a hard cap (e.g. 5) the item moves to a terminal error state, not back to pending
- [ ] **QUE-04**: A failed Stage 2 classification returns the item to `pending_stage2` and increments a retry counter; same hard cap applies
- [ ] **QUE-05**: An item stuck in `processing_*` longer than a stale-claim timeout (e.g. 10 min) is reclaimed back to its `pending_*` state on the next queue poll
- [ ] **QUE-06**: No item dropped into `/api/ingest` ends the run in `processing_*` — the queue is observable and self-healing on consumer crash

### Consumers (Stage 1 / Stage 2)

- [ ] **CONS-01**: Stage 1 consumer is a separate local process from the daemon; it polls `GET /api/queue?stage=1&limit=10` on an interval and runs up to 10 concurrent classifications
- [ ] **CONS-02**: Stage 2 consumer is a separate local process; it polls `GET /api/queue?stage=2&limit=2` and runs up to 2 concurrent classifications
- [ ] **CONS-03**: For file items, both consumers invoke `claude -p` with a prompt that includes the *file path* (and instructs Claude to read it), never the file content as an argv; binary files, large files, and files containing null bytes work without errors
- [ ] **CONS-04**: For Gmail items, both consumers invoke `claude -p` with a text prompt built from the message metadata (subject, from, snippet, headers) — no file path; Stage 2 receives the existing taxonomy as additional context
- [ ] **CONS-05**: Gmail "keep" items reliably advance from Stage 1 to Stage 2 and through the queue without manual intervention — the v1.0 bug where keeps remained at `processing` forever is fixed
- [ ] **CONS-06**: Each consumer POSTs the classification result (decision, confidence, axes/labels, proposed Drive path where applicable) to `POST /api/classify` and emits a Langfuse trace covering its end-to-end work

### Scanning

- [ ] **SCAN-01**: Daemon recurses into subdirectories with no depth limit
- [ ] **SCAN-02**: Daemon skips an entire directory tree if that directory contains a `.git` or `node_modules` entry — repos are never traversed
- [ ] **SCAN-03**: Daemon skips hidden files (`.DS_Store`, dotfiles); they are never enqueued

### Operational acceptance

- [ ] **ACC-01**: Daemon runs for 1 hour scanning `~/Downloads` + `~/Documents` with zero errors logged
- [ ] **ACC-02**: Gmail 6-month backfill completes without hanging — every message in the window either ingests or is explicitly rejected
- [ ] **ACC-03**: Items dropped via the Downloads or Gmail collectors flow through Stage 1 and Stage 2 and appear in the existing triage UI without operator intervention
- [ ] **ACC-04**: A runtime audit of the daemon process confirms `DATABASE_URL` is not in its environment; a runtime audit of consumer subprocess argv confirms file content is never present
- [ ] **ACC-05**: Langfuse traces span the daemon → API → consumer → API path so a single ingest can be reconstructed end-to-end from the dashboard

## v1.0 Requirements (Shipped)

Implementation existed at v1.0 milestone close (2026-04-24, all 4 phases complete). Some surfaces are being rewired in v1.1 but the user-visible requirements still hold.

### Ingest

- [x] **ING-01**: Downloads collector watches ~/Downloads via fsevents with launchd daemon, read-only (no writes to user filesystem)
- [x] **ING-02**: Gmail collector polls one account via OAuth read-only scope, incremental via historyId
- [x] **ING-03**: Content-hash dedup (SHA-256) in Neon prevents reprocessing across sources
- [x] **ING-04**: Size-band routing: PDF ≤5 MB content-read, images ≤10 MB content-read, installers always metadata-only, default ≤1 MB content-read
- [x] **ING-05**: Daemon heartbeat + polling fallback (fsevents can stop after ~1h)
- [x] **ING-06**: Gmail historyId 404 triggers full-sync fallback (not silent drop)

### Classification

- [x] **CLS-01**: Relevance gate classifies items as keep / ignore / uncertain via Claude CLI
- [x] **CLS-02**: Keep items upload to Drive _Inbox and proceed to label classifier
- [x] **CLS-03**: Ignore items store minimal Neon row (content_hash, source, reason) — no upload
- [x] **CLS-04**: Uncertain items route to relevance triage queue
- [x] **CLS-05**: Label classifier proposes candidates on 3 axes (Type / From / Context) from existing taxonomy with per-axis confidence
- [x] **CLS-06**: Label classifier emits proposed_drive_path derived from taxonomy
- [x] **CLS-07**: Above-threshold axes auto-archive; below-threshold axes route to label triage queue (partial-match routing)
- [x] **CLS-08**: Full classification trace stored (both stage outputs + confidence) before any item is filed

### Rules

- [x] **RUL-01**: Rules are single-line structured predicates (ext, size, source, sender-domain conditions)
- [x] **RUL-02**: Prefilter at classify time loads only matching rules; hard cap 20 rules per classification prompt
- [x] **RUL-03**: Redundancy check on every new rule write against its prefilter bucket
- [x] **RUL-04**: Weekly consolidation job proposes rule merges (never auto-merge)
- [x] **RUL-05**: Dormant rules (zero fires in 60 days) surface for deprecation (never auto-deleted)
- [x] **RUL-06**: Rule re-apply on change with preview diff; conflicts surface in review panel

### Triage UI

- [x] **TRI-01**: Inline-expanding queue list — active row expands into full card, collapsed rows are compact one-liners
- [x] **TRI-02**: Relevance mode: K keep / X ignore / S skip — single-action per card
- [x] **TRI-03**: Label mode: 3 axis fields (Type / From / Context), only unresolved axes highlighted, confident axes show auto-archived
- [x] **TRI-04**: Label mode controls: 1/2/3 pick proposal, N new category inline, S skip, Enter confirm, A archive-as-is, I ignore
- [x] **TRI-05**: J/K (or J/H) queue navigation with scroll-into-view
- [x] **TRI-06**: Undo via U key with toast notification
- [x] **TRI-07**: Cards have no background/border/rule — content only, subtle hover on collapsed
- [x] **TRI-08**: Whole collapsed card is clickable
- [x] **TRI-09**: Proposed Drive path displayed under axes in label mode
- [x] **TRI-10**: Target median decision time < 3 seconds once taxonomy matures

### Taxonomy

- [x] **TAX-01**: Per-axis list views (Types / Entities / Contexts) with item counts and last-used
- [x] **TAX-02**: Rename with cascade (propagates via rule rewrite + Drive moves)
- [x] **TAX-03**: Merge: select 2+ items, pick canonical, items and rules remap atomically with audit row
- [x] **TAX-04**: Split: open category, multi-select items, move to new category
- [x] **TAX-05**: Deprecate: hides from autocomplete, keeps historical assignments
- [x] **TAX-06**: Fuzzy-match dedup gate on new label creation to prevent fragmentation
- [x] **TAX-07**: Entity merge proposal inbox (nightly job) with side-by-side evidence — never auto-merge

### Drive

- [x] **DRV-01**: Two-phase lifecycle: _Inbox/{YYYY-MM}/{name} for items pending label triage
- [x] **DRV-02**: Background resolve job moves filed items to proposed_drive_path; drive_file_id stays stable
- [x] **DRV-03**: Cascading moves on taxonomy rename/merge/split — batched, rate-limited (3 ops/sec Drive API limit)
- [x] **DRV-04**: Per-item state tracking in Neon for cascade moves (not fire-and-forget)
- [x] **DRV-05**: Collision handling: append short hash suffix on same-name-in-folder

### Retrieval

- [x] **RET-01**: MCP search tool: embed query via OpenAI text-embedding-3-small (512d halfvec), pgvector HNSW + SQL filters on taxonomy
- [x] **RET-02**: Claude Haiku synthesizes answer with ≤5 inline citations (clickable to source) via /api/ask
- [x] **RET-03**: Claude is the sole retrieval surface — no manual search bar
- [x] **RET-04**: Embedding job runs on filed items only (not uncertain/ignored)
- [x] **RET-05**: Ask UI: serif input field, answer body with numbered citation badges, sources list with Drive paths

### Auth

- [x] **AUTH-01**: Clerk auth with MFA for web app
- [x] **AUTH-02**: Google OAuth for Drive/Gmail scopes handled by Mac agent (separate from Clerk)
- [x] **AUTH-03**: User-initiated delete: removes Drive blob + Neon rows + embeddings

### Observability

- [x] **OBS-01**: Langfuse traces on every classify / chunk / embed / ask call
- [x] **OBS-02**: /admin page: queue depths (relevance + label), relevance auto-decision rate, label auto-archive rate
- [x] **OBS-03**: /admin page: rule count, median rules-in-context, dormant-rule ratio
- [x] **OBS-04**: /admin page: retrieval latency, weekly pulse score
- [x] **OBS-05**: Metrics strip on main layout: north star + 5 leading indicators
- [x] **OBS-06**: uncertain_rate and auto_filed_rate instrumented from day one

### Design

- [x] **DSN-01**: Archival/library aesthetic: Newsreader serif display, Inter Tight UI sans, JetBrains Mono data
- [x] **DSN-02**: Warm ivory (#f6f2ea) / ink (#201d17) palette with umber accent (#8a4f1c); dark mode support
- [x] **DSN-03**: Sidebar with Cortex logo, nav items with keyboard shortcuts + queue counts, connection status footer
- [x] **DSN-04**: Metrics strip (6 cells) below topbar
- [x] **DSN-05**: Pixel-faithful implementation of Claude Design handoff prototype

## v2 Requirements (Future)

### Should-have (post-MVP)

- **BLK-01**: Bulk-triage list view for cold-start aid
- **BLK-02**: "Why this suggestion" explainer on classification proposals
- **BLK-03**: One-time bulk-ignore-obvious-noise action for session 1
- **RUL-07**: Rule conflict review panel
- **RET-06**: Saved / pinned questions

### Could-have (post-week-3)

- **BKF-01**: Backfill toggle for Gmail + Downloads history
- **DIG-01**: Weekly triage digest email
- **SHR-01**: Scoped read-only Drive share flow for accountants
- **CNF-01**: Confidence-threshold tuning UI

## Out of Scope

| Feature | Reason |
|---------|--------|
| Writes to user filesystem | Structurally enforced via macOS permissions |
| Auto-deletion | User-initiated only — safety constraint |
| Auto-keep above size threshold | Archive entry above threshold always human-confirmed |
| Pre-seeded taxonomy | RAT test requires emergence from zero |
| Historical backfill at launch | Forward-only; backfill gated post-week-3 |
| Auto entity merges | Proposals only — never auto |
| Fixed Drive path templates | Structure emerges from classifier |
| Collectors beyond Downloads + Gmail | Architecture pluggable, plugs unplugged for MVP |
| Multi-user / org model / billing | Schema tenancy-ready, product is not |
| Mobile-native app | Responsive web only |
| Manual search bar / filter UI | Claude is sole retrieval surface |
| ColBERT reranker | pgvector baseline first |
| Real-time collaborative triage | Single-user MVP |
| **v1.1: UI / triage / taxonomy / rules / admin / ask changes** | Non-goal for this milestone — re-architecture is invisible to the user |
| **v1.1: Schema changes beyond additive `Item.status` enum values** | Keeps the migration risk surface small |
| **v1.1: Drive upload flow changes** | Stays in the existing Vercel cron; consumers do not upload |
| **v1.1: Multi-user changes** | Out of scope — single-operator tool |

## Traceability

### v1.1 (Active — phase numbers continue from v1.0)

| Requirement | Phase | Status |
|-------------|-------|--------|
| DAEMON-01 | TBD | Pending |
| DAEMON-02 | TBD | Pending |
| DAEMON-03 | TBD | Pending |
| DAEMON-04 | TBD | Pending |
| DAEMON-05 | TBD | Pending |
| DAEMON-06 | TBD | Pending |
| API-01 | TBD | Pending |
| API-02 | TBD | Pending |
| API-03 | TBD | Pending |
| API-04 | TBD | Pending |
| API-05 | TBD | Pending |
| API-06 | TBD | Pending |
| QUE-01 | TBD | Pending |
| QUE-02 | TBD | Pending |
| QUE-03 | TBD | Pending |
| QUE-04 | TBD | Pending |
| QUE-05 | TBD | Pending |
| QUE-06 | TBD | Pending |
| CONS-01 | TBD | Pending |
| CONS-02 | TBD | Pending |
| CONS-03 | TBD | Pending |
| CONS-04 | TBD | Pending |
| CONS-05 | TBD | Pending |
| CONS-06 | TBD | Pending |
| SCAN-01 | TBD | Pending |
| SCAN-02 | TBD | Pending |
| SCAN-03 | TBD | Pending |
| ACC-01 | TBD | Pending |
| ACC-02 | TBD | Pending |
| ACC-03 | TBD | Pending |
| ACC-04 | TBD | Pending |
| ACC-05 | TBD | Pending |

**v1.1 Coverage:**
- v1.1 requirements: 32 total
- Mapped to phases: 0 (roadmap pending)
- Unmapped: 32 (will resolve at roadmap step)

### v1.0 (Shipped — historical reference)

| Requirement | Phase | Status |
|-------------|-------|--------|
| ING-01 | Phase 1 | Complete |
| ING-02 | Phase 1 | Complete |
| ING-03 | Phase 1 | Complete |
| ING-04 | Phase 1 | Complete |
| ING-05 | Phase 1 | Complete |
| ING-06 | Phase 1 | Complete |
| CLS-01 | Phase 1 | Complete |
| CLS-02 | Phase 1 | Complete |
| CLS-03 | Phase 1 | Complete |
| CLS-04 | Phase 1 | Complete |
| CLS-05 | Phase 1 | Complete |
| CLS-06 | Phase 1 | Complete |
| CLS-07 | Phase 1 | Complete |
| CLS-08 | Phase 1 | Complete |
| DRV-01 | Phase 1 | Complete |
| OBS-01 | Phase 1 | Complete |
| OBS-06 | Phase 1 | Complete |
| AUTH-01 | Phase 2 | Complete |
| AUTH-02 | Phase 2 | Complete |
| AUTH-03 | Phase 2 | Complete |
| TRI-01 | Phase 2 | Complete |
| TRI-02 | Phase 2 | Complete |
| TRI-03 | Phase 2 | Complete |
| TRI-04 | Phase 2 | Complete |
| TRI-05 | Phase 2 | Complete |
| TRI-06 | Phase 2 | Complete |
| TRI-07 | Phase 2 | Complete |
| TRI-08 | Phase 2 | Complete |
| TRI-09 | Phase 2 | Complete |
| TRI-10 | Phase 2 | Complete |
| DRV-02 | Phase 2 | Complete |
| DRV-03 | Phase 2 | Complete |
| DRV-04 | Phase 2 | Complete |
| DRV-05 | Phase 2 | Complete |
| DSN-01 | Phase 2 | Complete |
| DSN-02 | Phase 2 | Complete |
| DSN-03 | Phase 2 | Complete |
| DSN-04 | Phase 2 | Complete |
| DSN-05 | Phase 2 | Complete |
| OBS-05 | Phase 2 | Complete |
| TAX-01 | Phase 3 | Complete |
| TAX-02 | Phase 3 | Complete |
| TAX-03 | Phase 3 | Complete |
| TAX-04 | Phase 3 | Complete |
| TAX-05 | Phase 3 | Complete |
| TAX-06 | Phase 3 | Complete |
| TAX-07 | Phase 3 | Complete |
| RUL-01 | Phase 3 | Complete |
| RUL-02 | Phase 3 | Complete |
| RUL-03 | Phase 3 | Complete |
| RUL-04 | Phase 3 | Complete |
| RUL-05 | Phase 3 | Complete |
| RUL-06 | Phase 3 | Complete |
| OBS-02 | Phase 3 | Complete |
| OBS-03 | Phase 3 | Complete |
| OBS-04 | Phase 3 | Complete |
| RET-01 | Phase 4 | Complete |
| RET-02 | Phase 4 | Complete |
| RET-03 | Phase 4 | Complete |
| RET-04 | Phase 4 | Complete |
| RET-05 | Phase 4 | Complete |

---
*Requirements defined: 2026-04-24*
*Last updated: 2026-04-25 — milestone v1.1 (Ingest Pipeline Rearchitecture) requirements added*
