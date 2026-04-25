# Cortex

## What This Is

A personal AI-native information system that captures everything Daniel receives across Downloads and Gmail, learns his filing system from how he reacts to items, and answers anything in plain English from any device. Single-operator tool, not a product — internal-first with tenancy-ready schema.

## Core Value

The triage feedback loop compounds fast enough that weekly triage load trends down, not flat or up — Cortex learns to file so Daniel doesn't have to.

## Current Milestone: v1.1 Ingest Pipeline Rearchitecture

**Goal:** Restore backend isolation and make the ingest pipeline reliable — daemon becomes a thin metadata client, Neon access flows only through the Vercel API, and classification consumers pass file paths (not content) to `claude -p`.

**Target features:**
- Daemon refactor to thin metadata client (no `DATABASE_URL`, POSTs to `/api/ingest`)
- API ingest/queue/classify routes guarded by `CORTEX_API_KEY` shared secret
- Stage 1 (relevance) consumer — polls queue, claude reads files via path, max 10 concurrent
- Stage 2 (label) consumer — runs for both Downloads and Gmail items, max 2 concurrent, retry on failure
- Queue state machine on `Item.status` with explicit pending/processing/done/retry states
- Directory scanning rules — skip trees containing `.git`/`node_modules`, skip hidden files, no depth limit
- Operational acceptance — daemon runs 1h on Downloads+Documents with zero errors, Gmail 6-month backfill completes

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Downloads collector (launchd + fsevents, read-only, structurally sandboxed)
- [ ] Gmail collector (one account, OAuth read-only scope, incremental via historyId)
- [ ] Content-hash dedup across sources before any processing
- [ ] Two-stage triage pipeline: relevance gate then label classifier
- [ ] Relevance classifier with keep / ignore / uncertain routing
- [ ] Size-band pre-read thresholds (PDF 5 MB, images 10 MB, installers metadata-only, default 1 MB)
- [ ] Label classifier with partial-match routing and proposed_drive_path
- [ ] Rule system: structured predicates, prefilter, 20-rule cap, redundancy check on write
- [ ] Rule consolidation + deprecation jobs
- [ ] Triage UI: inline-expanding queue, keyboard-first, relevance + label modes
- [ ] Taxonomy management: rename, merge, split, deprecate with cascade + audit
- [ ] Drive two-phase lifecycle: _Inbox then model-proposed path; cascading moves on taxonomy ops
- [ ] MCP search tool + Claude Haiku Q&A with inline citations
- [ ] Clerk auth + MFA
- [ ] Langfuse observability + /admin metrics page
- [ ] User-initiated delete (Drive blob + Neon rows + embeddings)

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
| v1.1: Daemon must not access Neon directly | v1.0 daemon held `DATABASE_URL` and bypassed all validation — any bug could corrupt the DB; backend isolation enforced via API-only access with `CORTEX_API_KEY` | — Pending |
| v1.1: Pass file paths to `claude -p`, not content | argv content broke on binary files (null bytes), exceeded argument size limits, and exhausted file descriptors (EBADF/EMFILE) | — Pending |
| v1.1: Queue-driven consumers, not inline scan | Inline classification stuck items at `processing` forever on failure; queue with retry counts and explicit state machine fixes this and unblocks Gmail Stage 2 | — Pending |

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
*Last updated: 2026-04-25 — milestone v1.1 (Ingest Pipeline Rearchitecture) started*
