# Requirements: Cortex

**Defined:** 2026-04-24
**Core Value:** The triage feedback loop compounds fast enough that weekly triage load trends down — Cortex learns to file so Daniel doesn't have to.

## v1 Requirements

### Ingest

- [ ] **ING-01**: Downloads collector watches ~/Downloads via fsevents with launchd daemon, read-only (no writes to user filesystem)
- [ ] **ING-02**: Gmail collector polls one account via OAuth read-only scope, incremental via historyId
- [ ] **ING-03**: Content-hash dedup (SHA-256) in Neon prevents reprocessing across sources
- [ ] **ING-04**: Size-band routing: PDF ≤5 MB content-read, images ≤10 MB content-read, installers always metadata-only, default ≤1 MB content-read
- [ ] **ING-05**: Daemon heartbeat + polling fallback (fsevents can stop after ~1h)
- [ ] **ING-06**: Gmail historyId 404 triggers full-sync fallback (not silent drop)

### Classification

- [ ] **CLS-01**: Relevance gate classifies items as keep / ignore / uncertain via Claude CLI
- [ ] **CLS-02**: Keep items upload to Drive _Inbox and proceed to label classifier
- [ ] **CLS-03**: Ignore items store minimal Neon row (content_hash, source, reason) — no upload
- [ ] **CLS-04**: Uncertain items route to relevance triage queue
- [ ] **CLS-05**: Label classifier proposes candidates on 3 axes (Type / From / Context) from existing taxonomy with per-axis confidence
- [ ] **CLS-06**: Label classifier emits proposed_drive_path derived from taxonomy
- [ ] **CLS-07**: Above-threshold axes auto-archive; below-threshold axes route to label triage queue (partial-match routing)
- [ ] **CLS-08**: Full classification trace stored (both stage outputs + confidence) before any item is filed

### Rules

- [ ] **RUL-01**: Rules are single-line structured predicates (ext, size, source, sender-domain conditions)
- [ ] **RUL-02**: Prefilter at classify time loads only matching rules; hard cap 20 rules per classification prompt
- [ ] **RUL-03**: Redundancy check on every new rule write against its prefilter bucket
- [ ] **RUL-04**: Weekly consolidation job proposes rule merges (never auto-merge)
- [ ] **RUL-05**: Dormant rules (zero fires in 60 days) surface for deprecation (never auto-deleted)
- [ ] **RUL-06**: Rule re-apply on change with preview diff; conflicts surface in review panel

### Triage UI

- [ ] **TRI-01**: Inline-expanding queue list — active row expands into full card, collapsed rows are compact one-liners
- [ ] **TRI-02**: Relevance mode: K keep / X ignore / S skip — single-action per card
- [ ] **TRI-03**: Label mode: 3 axis fields (Type / From / Context), only unresolved axes highlighted, confident axes show auto-archived
- [ ] **TRI-04**: Label mode controls: 1/2/3 pick proposal, N new category inline, S skip, Enter confirm, A archive-as-is, I ignore
- [ ] **TRI-05**: J/K (or J/H) queue navigation with scroll-into-view
- [ ] **TRI-06**: Undo via U key with toast notification
- [ ] **TRI-07**: Cards have no background/border/rule — content only, subtle hover on collapsed
- [ ] **TRI-08**: Whole collapsed card is clickable
- [ ] **TRI-09**: Proposed Drive path displayed under axes in label mode
- [ ] **TRI-10**: Target median decision time < 3 seconds once taxonomy matures

### Taxonomy

- [ ] **TAX-01**: Per-axis list views (Types / Entities / Contexts) with item counts and last-used
- [ ] **TAX-02**: Rename with cascade (propagates via rule rewrite + Drive moves)
- [ ] **TAX-03**: Merge: select 2+ items, pick canonical, items and rules remap atomically with audit row
- [ ] **TAX-04**: Split: open category, multi-select items, move to new category
- [ ] **TAX-05**: Deprecate: hides from autocomplete, keeps historical assignments
- [ ] **TAX-06**: Fuzzy-match dedup gate on new label creation to prevent fragmentation
- [ ] **TAX-07**: Entity merge proposal inbox (nightly job) with side-by-side evidence — never auto-merge

### Drive

- [ ] **DRV-01**: Two-phase lifecycle: _Inbox/{YYYY-MM}/{name} for items pending label triage
- [ ] **DRV-02**: Background resolve job moves filed items to proposed_drive_path; drive_file_id stays stable
- [ ] **DRV-03**: Cascading moves on taxonomy rename/merge/split — batched, rate-limited (3 ops/sec Drive API limit)
- [ ] **DRV-04**: Per-item state tracking in Neon for cascade moves (not fire-and-forget)
- [ ] **DRV-05**: Collision handling: append short hash suffix on same-name-in-folder

### Retrieval

- [ ] **RET-01**: MCP search tool: embed query via OpenAI text-embedding-3-small (512d halfvec), pgvector HNSW + SQL filters on taxonomy
- [ ] **RET-02**: Claude Haiku synthesizes answer with ≤5 inline citations (clickable to source) via /api/ask
- [ ] **RET-03**: Claude is the sole retrieval surface — no manual search bar
- [ ] **RET-04**: Embedding job runs on filed items only (not uncertain/ignored)
- [ ] **RET-05**: Ask UI: serif input field, answer body with numbered citation badges, sources list with Drive paths

### Auth

- [ ] **AUTH-01**: Clerk auth with MFA for web app
- [ ] **AUTH-02**: Google OAuth for Drive/Gmail scopes handled by Mac agent (separate from Clerk)
- [ ] **AUTH-03**: User-initiated delete: removes Drive blob + Neon rows + embeddings

### Observability

- [ ] **OBS-01**: Langfuse traces on every classify / chunk / embed / ask call
- [ ] **OBS-02**: /admin page: queue depths (relevance + label), relevance auto-decision rate, label auto-archive rate
- [ ] **OBS-03**: /admin page: rule count, median rules-in-context, dormant-rule ratio
- [ ] **OBS-04**: /admin page: retrieval latency, weekly pulse score
- [ ] **OBS-05**: Metrics strip on main layout: north star + 5 leading indicators
- [ ] **OBS-06**: uncertain_rate and auto_filed_rate instrumented from day one

### Design

- [ ] **DSN-01**: Archival/library aesthetic: Newsreader serif display, Inter Tight UI sans, JetBrains Mono data
- [ ] **DSN-02**: Warm ivory (#f6f2ea) / ink (#201d17) palette with umber accent (#8a4f1c); dark mode support
- [ ] **DSN-03**: Sidebar with Cortex logo, nav items with keyboard shortcuts + queue counts, connection status footer
- [ ] **DSN-04**: Metrics strip (6 cells) below topbar
- [ ] **DSN-05**: Pixel-faithful implementation of Claude Design handoff prototype

## v2 Requirements

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

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ING-01 | Phase 1 | Pending |
| ING-02 | Phase 1 | Pending |
| ING-03 | Phase 1 | Pending |
| ING-04 | Phase 1 | Pending |
| ING-05 | Phase 1 | Pending |
| ING-06 | Phase 1 | Pending |
| CLS-01 | Phase 1 | Pending |
| CLS-02 | Phase 1 | Pending |
| CLS-03 | Phase 1 | Pending |
| CLS-04 | Phase 1 | Pending |
| CLS-05 | Phase 1 | Pending |
| CLS-06 | Phase 1 | Pending |
| CLS-07 | Phase 1 | Pending |
| CLS-08 | Phase 1 | Pending |
| DRV-01 | Phase 1 | Pending |
| OBS-01 | Phase 1 | Pending |
| OBS-06 | Phase 1 | Pending |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| TRI-01 | Phase 2 | Pending |
| TRI-02 | Phase 2 | Pending |
| TRI-03 | Phase 2 | Pending |
| TRI-04 | Phase 2 | Pending |
| TRI-05 | Phase 2 | Pending |
| TRI-06 | Phase 2 | Pending |
| TRI-07 | Phase 2 | Pending |
| TRI-08 | Phase 2 | Pending |
| TRI-09 | Phase 2 | Pending |
| TRI-10 | Phase 2 | Pending |
| DRV-02 | Phase 2 | Pending |
| DRV-03 | Phase 2 | Pending |
| DRV-04 | Phase 2 | Pending |
| DRV-05 | Phase 2 | Pending |
| DSN-01 | Phase 2 | Pending |
| DSN-02 | Phase 2 | Pending |
| DSN-03 | Phase 2 | Pending |
| DSN-04 | Phase 2 | Pending |
| DSN-05 | Phase 2 | Pending |
| OBS-05 | Phase 2 | Pending |
| TAX-01 | Phase 3 | Pending |
| TAX-02 | Phase 3 | Pending |
| TAX-03 | Phase 3 | Pending |
| TAX-04 | Phase 3 | Pending |
| TAX-05 | Phase 3 | Pending |
| TAX-06 | Phase 3 | Pending |
| TAX-07 | Phase 3 | Pending |
| RUL-01 | Phase 3 | Pending |
| RUL-02 | Phase 3 | Pending |
| RUL-03 | Phase 3 | Pending |
| RUL-04 | Phase 3 | Pending |
| RUL-05 | Phase 3 | Pending |
| RUL-06 | Phase 3 | Pending |
| OBS-02 | Phase 3 | Pending |
| OBS-03 | Phase 3 | Pending |
| OBS-04 | Phase 3 | Pending |
| RET-01 | Phase 4 | Pending |
| RET-02 | Phase 4 | Pending |
| RET-03 | Phase 4 | Pending |
| RET-04 | Phase 4 | Pending |
| RET-05 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 61 total (file previously stated 48 — recount from actual requirement IDs)
- Mapped to phases: 61
- Unmapped: 0

---
*Requirements defined: 2026-04-24*
*Last updated: 2026-04-24 after roadmap creation — traceability populated*
