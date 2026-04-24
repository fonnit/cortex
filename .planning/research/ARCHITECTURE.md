# Architecture Patterns

**Domain:** AI-native personal information triage system
**Researched:** 2026-04-24

## Recommended Architecture

Three-tier system with a unidirectional data flow: Mac agent ingests and classifies, Neon stores state, Vercel web app exposes UI and retrieval. Google Drive is blob storage. Langfuse is a side-channel observer — no requests route through it.

```
[Downloads folder] ──fsevents──┐
                               ├──► Mac Agent (launchd daemon)
[Gmail API] ──historyId poll──┘         │
                                        │ (1) content-hash dedup
                                        │ (2) relevance classify (Claude CLI)
                                        │ (3) label classify (Claude CLI)
                                        │ (4) upload to Drive _Inbox
                                        ▼
                               [Neon Postgres]
                                    items
                                    taxonomy
                                    rules
                                    embeddings (pgvector HNSW halfvec 512d)
                                        │
                        ┌──────────────┴──────────────┐
                        ▼                             ▼
              Vercel API routes               Vercel cron routes
              - /api/triage/*                 - /api/jobs/resolve
              - /api/taxonomy/*              - /api/jobs/embeddings
              - /api/ask                     - /api/jobs/consolidate-rules
              - /api/admin/*
                        │
              Next.js App Router
              - Triage queue UI
              - Taxonomy management
              - NL retrieval surface
              - Admin/metrics dashboard
                        │
              [Drive API]  ← resolve job moves items from _Inbox to classified path
              [Langfuse]   ← spans emitted from Mac agent + Vercel routes (side-channel)
```

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Mac Agent | File-system watch, Gmail poll, dedup, two-stage classify, Drive upload, rule prefilter | Neon (write items), Drive API (upload blobs), Claude CLI (classify), Langfuse (trace spans) |
| Neon Postgres | Source of truth for all item state, taxonomy, rules, embeddings | Mac agent (writes), Vercel API routes (reads + writes), cron jobs (writes) |
| Vercel API routes | Triage decisions, taxonomy ops, NL retrieval, admin metrics | Neon, Drive API (resolve + move), OpenAI (embed query), Claude Haiku (Q&A synthesis), Langfuse |
| Vercel cron routes | Drive resolve job, embedding generation, rule consolidation | Neon, Drive API |
| Next.js UI | Render triage queue, taxonomy management, retrieval surface | Vercel API routes only |
| Google Drive | Blob storage (two-phase: `_Inbox/` then classified path) | Mac agent (upload), cron resolve job (move) |
| Langfuse | Observability — receives trace spans, zero influence on request path | Mac agent, Vercel routes (push-only) |

## Data Flow

### Ingest path (Mac agent → Neon → Drive)

1. fsevents fires on Downloads write or Gmail poll fires on schedule.
2. Compute content hash; query Neon `items.content_hash` — skip if exists.
3. Size-band check: PDF >5 MB → metadata-only; image >10 MB → metadata-only; installer → metadata-only; default threshold 1 MB.
4. Relevance classify via Claude CLI: `keep | ignore | uncertain`. `ignore` records row with `status=ignored`, exits pipeline.
5. For `keep` and `uncertain`: label classify via Claude CLI → `proposed_label`, `proposed_drive_path`.
6. Upload file to Drive `_Inbox/{content_hash}`.
7. Write item row to Neon: `status = certain | uncertain`, `proposed_drive_path`, `drive_inbox_id`, `source`, `content_hash`, `metadata`.
8. Emit Langfuse spans for both classify calls.

### Triage path (UI → Neon → cron → Drive)

1. User loads triage queue: `GET /api/triage` returns items where `status = uncertain`, ordered by ingested_at.
2. User accepts/edits label and path → `PATCH /api/triage/{id}` writes `status = resolved`, `confirmed_drive_path`.
3. Cron resolve job (`/api/jobs/resolve`, runs every minute on Pro plan) claims resolved items atomically, moves Drive blob from `_Inbox/{hash}` to `confirmed_drive_path`, updates `status = filed`.

### Embedding path (Neon → pgvector)

1. Cron embedding job claims items with `status = filed` and `embedding IS NULL`.
2. OpenAI `text-embedding-3-small` at 512 dims → `halfvec` stored in `items.embedding`.
3. HNSW index on `embedding` column using `halfvec_l2_ops`.

### Retrieval path (UI → Vercel → Neon → Claude Haiku)

1. User submits NL query to retrieval surface.
2. `POST /api/ask`: embed query with OpenAI → pgvector cosine search top-k items.
3. Fetch item text/metadata for top-k hits.
4. Prompt Claude Haiku with hits + query → synthesized answer with inline citations.
5. Emit Langfuse span for embed + synthesis calls.

### Taxonomy operations (cascading)

1. Rename/merge/split/deprecate via `PATCH /api/taxonomy/{id}`.
2. API route executes cascade: update all `items.confirmed_label`, enqueue Drive path-move jobs for filed items, write audit row.
3. Drive moves execute in cron resolve job batch — same job handles both triage resolves and taxonomy cascades.

## Anti-Patterns to Avoid

### Daemon calling Vercel API routes
Mac agent must write to Neon directly via Prisma (or pg connection). Routing through Vercel adds latency, cold-start risk, and a circular auth dependency. Daemon owns its Neon connection string.

### Embedding at ingest time
Embed only after item is `filed`. Embedding uncertain items wastes tokens and produces low-signal vectors (no confirmed label context). Cron job handles this asynchronously.

### Drive as primary state
Drive is blob storage only. All queryable state (path, label, status, metadata) lives in Neon. Drive paths are derived from Neon rows, never the inverse.

### Rule system on the hot path
Rules prefilter runs in the daemon before Claude classify calls, not as a Claude prompt prefix. Structured predicates evaluate in process — no LLM call for rule matching.

### Langfuse on the critical path
Langfuse writes are fire-and-forget with `forceFlush()` at agent shutdown and at end of serverless handler. Langfuse SDK failure must never block item processing.

## Suggested Build Order

Dependencies flow strictly in this order:

1. **Neon schema + Prisma setup** — everything else depends on it; no component works without the DB.
2. **Mac agent core** — ingest loop (fsevents + Gmail historyId poll), dedup, Drive upload, item write. No classify yet — proves the pipeline end-to-end.
3. **Two-stage classifier in Mac agent** — relevance gate then label classifier; rule prefilter wired in; Langfuse spans.
4. **Vercel API skeleton + Clerk auth** — `/api/triage`, `/api/taxonomy`, stubs for cron routes; no UI yet.
5. **Cron resolve job** — Drive moves from `_Inbox` to classified path; unblocks end-to-end filing.
6. **Triage UI** — inline-expanding queue, keyboard-first, label + path editing; depends on working API + cron.
7. **Embedding cron + pgvector index** — runs after filed items exist.
8. **NL retrieval (`/api/ask`)** — depends on embeddings existing; Claude Haiku synthesis.
9. **Taxonomy management UI + cascade logic** — rename/merge/split/deprecate with Drive cascade.
10. **Admin dashboard + Langfuse metrics** — observability surface; safe to defer.
11. **Rule management UI** — rule creation, redundancy check, consolidation job; UX polish layer.

## Scalability Considerations

| Concern | Single operator (current) | If multi-user later |
|---------|--------------------------|---------------------|
| Neon connections | Single Prisma client in daemon + Vercel pooled via PgBouncer | Add `user_id` FK everywhere; connection pool per tenant |
| Drive paths | One Drive account, flat `_Inbox` | Per-user Drive OAuth + folder namespace |
| pgvector search | HNSW index, no partitioning needed | Partition by user_id; filtered HNSW |
| Cron jobs | Single Vercel cron per job type | Job queue with user_id scoping |
| Gmail poll | Single historyId cursor in Neon | Per-user cursor row |

Schema is single-operator now; `user_id` column should exist from day one (PROJECT.md: "tenancy-ready schema") but no multi-user logic in MVP.

## Sources

- Neon pgvector + halfvec: [neon.com/blog/dont-use-vector-use-halvec-instead](https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost)
- pgvector HNSW: [neon.com/blog/understanding-vector-search-and-hnsw-index-with-pgvector](https://neon.com/blog/understanding-vector-search-and-hnsw-index-with-pgvector)
- Gmail historyId sync: [developers.google.com/workspace/gmail/api/guides/sync](https://developers.google.com/workspace/gmail/api/guides/sync)
- Vercel cron jobs: [vercel.com/docs/cron-jobs/manage-cron-jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- Langfuse Next.js: [langfuse.com/integrations/frameworks/vercel-ai-sdk](https://langfuse.com/integrations/frameworks/vercel-ai-sdk)
- fsevents Node.js: [github.com/fsevents/fsevents](https://github.com/fsevents/fsevents)
- launchd: [launchd.info](https://launchd.info/)
