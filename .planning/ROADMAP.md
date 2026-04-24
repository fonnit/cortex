# Roadmap: Cortex

## Overview

Schema and daemon first — no data, no product. Phase 1 stands up the Neon schema, Mac agent ingest loop, and two-stage classification pipeline with Langfuse instrumentation. Phase 2 brings the web app to life: Clerk auth, the archival design system, and the keyboard-first triage queue with Drive resolve cron. Phase 3 adds the compounding layers — taxonomy operations, rule system, and the /admin metrics surface that validates the core hypothesis. Phase 4 closes the loop with embeddings and natural-language retrieval.

## Phases

- [x] **Phase 1: Foundation** - Neon schema, Mac daemon, two-stage classification pipeline, Drive _Inbox upload, Langfuse instrumentation (completed 2026-04-24)
- [x] **Phase 2: Triage & Web App** - Clerk auth, archival design system, keyboard-first triage queue, Drive resolve cron (completed 2026-04-24)
- [x] **Phase 3: Taxonomy, Rules & Admin** - Taxonomy ops (rename/merge/split/deprecate), rule system, /admin metrics (completed 2026-04-24)
- [ ] **Phase 4: Retrieval** - Embedding cron, pgvector HNSW index, /api/ask with Claude Haiku synthesis and inline citations

## Phase Details

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
- [ ] 04-01-PLAN.md — embedTexts helper + POST /api/cron/embed (filed-only, batch 50) + HNSW migration
- [ ] 04-02-PLAN.md — POST /api/ask (embed query → ANN → Haiku synthesis → AskResponse)
- [ ] 04-03-PLAN.md — AskPage (/ask) pixel-faithful to design prototype + citedAnswers in /api/metrics + human checkpoint

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 6/6 | Complete    | 2026-04-24 |
| 2. Triage & Web App | 5/5 | Complete    | 2026-04-24 |
| 3. Taxonomy, Rules & Admin | 6/6 | Complete    | 2026-04-24 |
| 4. Retrieval | 0/3 | Not started | - |
