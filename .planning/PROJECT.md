# Cortex

## What This Is

A personal AI-native information system that captures everything Daniel receives across Downloads and Gmail, learns his filing system from how he reacts to items, and answers anything in plain English from any device. Single-operator tool, not a product — internal-first with tenancy-ready schema.

## Core Value

The triage feedback loop compounds fast enough that weekly triage load trends down, not flat or up — Cortex learns to file so Daniel doesn't have to.

## Shipped Milestones

- **v1.0 — Initial Build** (2026-04-24): full vertical ingest → classify → triage → taxonomy → rules → retrieval, Phases 1–4. See `.planning/ROADMAP.md` for phase details.
- **v1.1 — Ingest Pipeline Rearchitecture** (2026-04-25, code-complete; live operator acceptance pending): thin daemon, Vercel-API-only Neon access, queue-driven consumers passing file paths to `claude -p`, scan rule fixes, operational acceptance toolkit. Phases 5–8. Archive: `.planning/milestones/v1.1-ROADMAP.md`. Audit: `.planning/v1.1-MILESTONE-AUDIT.md`.

## Requirements

### Validated (shipped in v1.0)

- [x] Downloads collector (launchd + fsevents, read-only, structurally sandboxed)
- [x] Gmail collector (one account, OAuth read-only scope, incremental via historyId)
- [x] Content-hash dedup across sources before any processing
- [x] Two-stage triage pipeline: relevance gate then label classifier
- [x] Relevance classifier with keep / ignore / uncertain routing
- [x] Size-band pre-read thresholds (PDF 5 MB, images 10 MB, installers metadata-only, default 1 MB)
- [x] Label classifier with partial-match routing and proposed_drive_path
- [x] Rule system: structured predicates, prefilter, 20-rule cap, redundancy check on write
- [x] Rule consolidation + deprecation jobs
- [x] Triage UI: inline-expanding queue, keyboard-first, relevance + label modes
- [x] Taxonomy management: rename, merge, split, deprecate with cascade + audit
- [x] Drive two-phase lifecycle: _Inbox then model-proposed path; cascading moves on taxonomy ops
- [x] MCP search tool + Claude Haiku Q&A with inline citations
- [x] Clerk auth + MFA
- [x] Langfuse observability + /admin metrics page
- [x] User-initiated delete (Drive blob + Neon rows + embeddings)

### Validated (shipped in v1.1)

- [x] Daemon thin client — no DATABASE_URL, POSTs metadata to /api/ingest with CORTEX_API_KEY (DAEMON-01..06)
- [x] API ingest/queue/classify surface — atomic claim (FOR UPDATE SKIP LOCKED), retry-with-cap, stale-claim reclaim (API-01..06, QUE-01..06)
- [x] Stage 1 + Stage 2 consumer processes — file paths to claude -p, independent worker pools (CONS-01..06)
- [x] Directory scanning rules — recurse unbounded, skip .git/node_modules trees, skip hidden files (SCAN-01..03)
- [x] Operational acceptance toolkit — audit scripts, RUNBOOK, ACCEPTANCE skeleton (ACC-01..05; live operator runs pending)

### Active

(None — milestone v1.1 ships next)

### Out of Scope

- Writes to user local filesystem — structurally enforced via macOS permissions
- Auto-deletion of anything — user-initiated only
- Auto-keep above size threshold — always human-confirmed
- Pre-seeded taxonomy — strictly emergent
- Historical backfill at launch — forward-only; backfill script gated post-week-3
- Auto entity merges — proposals only
- Fixed path templates — structure emerges from classifier
- Collectors beyond Downloads + Gmail — architecture pluggable, plugs unplugged
- Second user / multi-user / org model / billing — schema ready, product not
- Mobile-native app — responsive web only
- Manual search bar — Claude is sole retrieval surface
- ColBERT reranker / structured extraction / compliance-grade retention

## Context

Daniel is a single operator running FonnIT (AI-native software studio). Mac-native, Gmail-centric, 50+ inbound artifacts/week across email + local. Manual filing has collapsed — existing tools impose schemas. No single queryable surface across channels.

The system has three tiers: a Mac agent (launchd daemon handling ingest + classification via Claude CLI), a Vercel web app (triage UI + taxonomy + retrieval + admin), and Neon Postgres (items, taxonomy, rules, embeddings). Google Drive is the blob store. Langfuse provides observability.

Design direction: archival/library meets operator tool. Newsreader serif for display, Inter Tight for UI, JetBrains Mono for data. Warm ivory/ink palette with umber accent. Inline-expanding queue cards (no card chrome — content only). Keyboard-first throughout.

## Constraints

- **Storage**: Neon Postgres only — no SQLite, no in-memory stores
- **Migrations**: Prisma through Vercel build, never locally
- **Auth**: Clerk with MFA; Google OAuth for Drive/Gmail scopes handled by Mac agent
- **Embeddings**: OpenAI text-embedding-3-small, 512 dims, halfvec in pgvector
- **Retrieval**: Claude Haiku for Q&A synthesis
- **Classification**: Claude via Mac agent CLI
- **Blob store**: Google Drive (two-phase lifecycle)
- **Observability**: Langfuse traces on every classify/chunk/embed/ask call
- **Compliance**: Don't escalate spec constraints into MVP-blocking gates

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Two-stage triage (relevance then label) | Prevents noise from ever entering the archive; each stage has its own rules and queue | — Pending |
| No pre-seeded taxonomy | RAT test: the feedback loop must compound from zero | — Pending |
| Claude is sole retrieval surface | Forces NL retrieval to be good enough; no manual search crutch | — Pending |
| Drive as blob store, not S3 | Daniel already uses Drive; keeps files accessible outside Cortex | — Pending |
| Inline-expanding queue cards | Design iteration with Daniel: merged card + queue into one surface | — Pending |
| v1.1: Daemon must not access Neon directly | v1.0 daemon held `DATABASE_URL` and bypassed all validation — any bug could corrupt the DB; backend isolation enforced via API-only access with `CORTEX_API_KEY` | ✓ Shipped (Phase 6) |
| v1.1: Pass file paths to `claude -p`, not content | argv content broke on binary files (null bytes), exceeded argument size limits, and exhausted file descriptors (EBADF/EMFILE) | ✓ Shipped (Phase 7) |
| v1.1: Queue-driven consumers, not inline scan | Inline classification stuck items at `processing` forever on failure; queue with retry counts and explicit state machine fixes this and unblocks Gmail Stage 2 | ✓ Shipped (Phases 5+7) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? Move to Out of Scope with reason
2. Requirements validated? Move to Validated with phase reference
3. New requirements emerged? Add to Active
4. Decisions to log? Add to Key Decisions
5. "What This Is" still accurate? Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-25 — milestone v1.1 code-complete; live operator acceptance pending*
