# Project Research Summary

**Project:** Cortex
**Domain:** AI-native personal information triage and retrieval system
**Researched:** 2026-04-24
**Confidence:** MEDIUM-HIGH

## Executive Summary

Cortex is a Mac daemon + Vercel web app that automates personal information triage: ingest from Downloads and Gmail, classify relevance then label via a two-stage LLM pipeline, store blobs in Google Drive, expose a keyboard-first queue for human review of uncertain items, and answer natural-language queries via semantic search. The core value proposition — triage load trends down over time as rules compound — is the product's RAT, and it must be instrumented from day one or it will never be validated. The architecture is a strict three-tier unidirectional flow: Mac agent writes to Neon, Vercel reads from Neon. No circular calls.

The recommended stack is fully constraint-driven: Next.js 16 + Clerk 7 + Prisma 7 + Neon Postgres with pgvector. The Mac daemon runs as a launchd KeepAlive process on Node 22 using chokidar 5 for FSEvents and the googleapis client for Gmail. All LLM calls use Claude Haiku via the Anthropic SDK for classification and OpenAI text-embedding-3-small at 512 dimensions for retrieval. All decisions trace through Langfuse. Versions are verified against npm registry as of 2026-04-24.

The two highest risks are structural: the feedback loop failing to trend down (taxonomy fragmentation + rule stagnation) and silent collector failures (FSEvents daemon death, Gmail historyId expiry). Both require instrumentation in Phase 1 before the triage UI ships. If uncertain_rate is not tracked from week 1, the core hypothesis is untestable.

## Key Findings

### Recommended Stack

The stack is determined by explicit PROJECT.md constraints (Clerk, Prisma migrations via Vercel build, Neon only, Langfuse) plus verified current-stable versions. The web app targets Next.js App Router with React Server Components — the right model for a triage UI that is mostly server-read with occasional mutations. The Mac daemon is a standalone Node 22 process, not a serverless function, because it requires persistent FSEvents subscriptions and a long-lived process under launchd.

**Core technologies:**
- Next.js 16.2.4 + React 19: Web framework with App Router and RSC — eliminates most client-state complexity for a queue UI
- Prisma 7.8.0 + @prisma/adapter-neon: ORM with Vercel-build migrations and edge-compatible Neon HTTP transport
- Neon Postgres + pgvector (halfvec 512d, HNSW): Single data store for items, taxonomy, rules, and embeddings — 50% storage savings vs vector(1536) with no recall regression at this scale
- Clerk 7.2.5: User identity only; Google OAuth for Drive/Gmail scopes handled separately in the Mac agent
- chokidar 5 + launchd: ESM-only FSEvents watcher in a KeepAlive daemon — zero polling for Downloads
- @anthropic-ai/sdk 0.91.0: Two-stage classification in the daemon (relevance gate then label classifier, both Claude Haiku)
- openai 6.34.0: text-embedding-3-small at 512 dims, called only after items are filed
- langfuse 3.38.20: Side-channel observability — every classify/chunk/embed/ask call gets a span; pinned to v3 until Langfuse cloud platform confirms >= 3.95.0

### Expected Features

**Must have (table stakes):**
- Downloads + Gmail ingest with content-hash dedup — without capture, nothing else works
- Two-stage triage pipeline (relevance gate then label classifier) — the core automation
- Keyboard-first triage queue with inline expansion — the primary human surface
- Confirm-before-filing gate — auto-file without confirmation destroys trust
- Drive two-phase lifecycle (_Inbox to classified path via cron) — blob management
- Natural-language retrieval with inline citations — expected in any AI-native tool; keyword fallback explicitly excluded
- Auth + MFA via Clerk — single-user personal data, non-negotiable security baseline
- User-initiated delete with full cascade (Drive + Neon + embeddings) — data ownership

**Should have (differentiators):**
- Emergent taxonomy with fuzzy-match label dedup before creation — the compounding feedback loop depends on this
- Rule system with 20-rule cap, redundancy check, and consolidation job — prevents rule rot
- uncertain_rate + auto_filed_rate metrics tracked from day one — the RAT instrumentation
- Langfuse spans on every LLM call + /admin metrics surface — operator-grade visibility
- Tenancy-ready schema with user_id from day one — no rework if a second user arrives

**Defer (v2+):**
- Rule consolidation job (manual rule management sufficient until cap is approached)
- /admin metrics page (Langfuse dashboard covers needs until justified)
- Taxonomy split + deprecate operations (rename + merge cover 80% of cases at launch)
- Backfill script (gated to post-week-3 when taxonomy has initial structure)
- Additional collectors beyond Downloads + Gmail — keep plugs unplugged until core loop is proven

**Explicit anti-features:** pre-seeded taxonomy, manual search bar, auto-deletion, auto-keep above size threshold, historical backfill at launch, mobile-native app.

### Architecture Approach

Three-tier, unidirectional: Mac agent (launchd daemon) ingests and classifies, writes directly to Neon via Prisma serverless driver. Vercel API routes and cron jobs read/write Neon, orchestrate Drive moves, and serve the Next.js UI. Langfuse is a push-only side channel — it never sits on a request path. Drive is blob storage only; all queryable state lives in Neon. The daemon must never call Vercel API routes.

**Major components:**
1. Mac Agent — fsevents + Gmail poll, content-hash dedup, size-band pre-read, two-stage classify, Drive upload to _Inbox, item write to Neon, Langfuse spans
2. Neon Postgres — source of truth for items, taxonomy, rules, embeddings; pgvector HNSW index on halfvec(512) embedding column
3. Vercel API routes — triage actions, taxonomy ops, NL retrieval (/api/ask), admin metrics; all authenticated via Clerk
4. Vercel cron routes — Drive resolve job (moves blobs from _Inbox to classified path), embedding generation job, rule consolidation job
5. Next.js UI — triage queue, taxonomy management, retrieval surface; communicates only with Vercel API routes
6. Google Drive — two-phase blob store; _Inbox/{content_hash} at ingest, confirmed_drive_path after resolve
7. Langfuse — receives trace spans from daemon + Vercel routes; zero influence on any request path

### Critical Pitfalls

1. **Feedback loop trends flat, not down** — Track uncertain_rate and auto_filed_rate from day one; define the RAT threshold concretely (>=5% weekly drop for 3 consecutive weeks = passing); run consolidation after every 50 triage decisions in the first 30 days, not weekly.

2. **Taxonomy fragmentation via emergent drift** — Before creating a new label, fuzzy-match against existing taxonomy (Levenshtein + embedding similarity); propose existing label if score >0.85; hard cap at 50 labels for MVP; surface auto-merge proposals when cosine similarity between label embeddings exceeds 0.90.

3. **Gmail historyId expiry causing silent message gaps** — Treat 404 as a first-class state: fall back to full sync from last_successful_poll_at timestamp; persist both cursor and timestamp to Neon (not local file); emit a Langfuse event for every fallback.

4. **FSEvents daemon silently dying after hours** — Emit a Langfuse heartbeat every 5 minutes; add a polling fallback (stat Downloads mtime every 15 minutes); scan Downloads for files newer than last_processed_at on every daemon init.

5. **Two-stage classification errors compounding** — Store full trace (both stage outputs, confidence scores, rule matches) as a JSON column on the item row AND in Langfuse; route to uncertain if either stage confidence is below 0.75; add a re-classify action to the triage UI.

6. **Drive cascade move orphaning during taxonomy renames** — Track every move as a job with item-level state (pending, moved, failed) in Neon; rate-limit at 2 ops/sec; do not mark old label deprecated until all moves reach moved status.

## Implications for Roadmap

### Phase 1: Foundation — Schema, Daemon Core, Two-Stage Pipeline
**Rationale:** Everything else depends on the database schema and the daemon being able to ingest and classify items. Schema decisions for trace storage, cursor persistence, and near_duplicate_of FK cannot be retrofitted after data exists.
**Delivers:** Working end-to-end ingest loop — file or email arrives, gets classified, lands in Neon with full trace, blob in Drive _Inbox. Triage metrics instrumented.
**Addresses:** Ingest, dedup, two-stage pipeline, Drive _Inbox upload, Langfuse spans, uncertain_rate tracking.
**Avoids:** Pitfalls 1, 3, 4, 5 — all require schema decisions or daemon instrumentation from day one.
**Research flag:** No additional research needed — patterns are well-documented; implementation is execution work.

### Phase 2: Triage UI + Drive Resolve
**Rationale:** The cron resolve job and triage UI are co-dependent — the UI is the approval gate that triggers the resolve job. Both require Phase 1 pipeline to have produced uncertain and certain items in Neon.
**Delivers:** Keyboard-first triage queue where uncertain items are reviewed, labels and paths are edited, and Drive moves from _Inbox to classified paths are triggered.
**Addresses:** Triage queue (keyboard-first, inline-expand), confirm-before-filing gate, Drive two-phase lifecycle, resolve cron job.
**Avoids:** Pitfall 6 (Drive cascade job with item-level state), Pitfall 12 (keyboard navigation spec defined before implementation).
**Research flag:** No additional research needed — queue UI patterns are standard; Drive resolve is a documented operation.

### Phase 3: Taxonomy Management + Emergent Label Controls
**Rationale:** Taxonomy operations require filed items to exist. Fuzzy-match dedup on label creation must be in place before the taxonomy grows beyond 20 labels, which happens organically after the first few weeks of real ingest.
**Delivers:** Taxonomy rename and merge with cascading Drive moves; auto-merge proposals surfaced in UI; hard 50-label cap enforced at creation; label embedding similarity checks.
**Addresses:** Emergent taxonomy, taxonomy rename/merge, cascade move jobs, taxonomy merge proposals.
**Avoids:** Pitfall 2 (fuzzy-match at label creation; auto-merge threshold; hard size cap).
**Research flag:** No additional research needed — fuzzy-match and cosine similarity patterns are established.

### Phase 4: Embedding + NL Retrieval
**Rationale:** Embeddings are generated only after items are filed. Filed items require the triage UI and resolve job from Phases 2-3. The retrieval surface has no data to search until the first items are filed.
**Delivers:** Async embedding cron job; HNSW index on halfvec(512); /api/ask with Claude Haiku synthesis and inline citations; recall@10 baseline measurement.
**Addresses:** Natural-language retrieval, inline citations, embedding cron, pgvector HNSW index.
**Avoids:** Pitfall 3 (silent retrieval degradation — baseline queries defined from launch), Pitfall 8 (halfvec recall benchmarked on real data before committing).
**Research flag:** Consider /gsd-research-phase for chunking strategy — document-type-aware chunking (emails vs PDFs) has meaningful recall impact and the right approach deserves explicit research.

### Phase 5: Rule System + Feedback Loop Validation
**Rationale:** The rule system is a compounding layer on top of the working pipeline. Rules require a taxonomy to reference and classifier history to learn from. The consolidation job requires enough rule history to merge against.
**Delivers:** Rule creation UI, 20-rule cap enforcement, redundancy check, consolidation job (runs after every 50 decisions in first 30 days), /admin metrics page surfacing uncertain_rate trend.
**Addresses:** Rule system, rule consolidation, /admin metrics, feedback loop RAT validation.
**Avoids:** Pitfall 1 (uncertain_rate trend must show measurable descent by week 6 or rule schema is wrong).
**Research flag:** No additional research needed — rule deduplication and consolidation patterns are internal logic.

### Phase Ordering Rationale

- Phase 1 before everything: no data = no product; schema decisions are irreversible after data exists.
- Phase 2 before Phase 3: taxonomy operations require filed items; filed items require the resolve job.
- Phase 4 after Phase 2: embeddings only on filed items — indexing uncertain items wastes tokens and produces misaligned vectors.
- Phase 5 last: the rule system is a feedback amplifier; it has nothing to amplify until the core triage loop is accumulating decisions.
- Pitfalls 1 and 2 both require Phase 1 schema work — they cannot be addressed post-launch without migrations.

### Research Flags

Needs /gsd-research-phase during planning:
- **Phase 4:** Document-type-aware chunking strategy — email vs PDF chunking has significant recall impact; sparse documentation for the specific combination of Neon halfvec + text-embedding-3-small at 512 dims on mixed personal document types.

Standard patterns (skip research-phase):
- **Phase 1:** launchd daemon, Gmail historyId sync, Prisma + Neon setup — all well-documented with official guides.
- **Phase 2:** Queue UI with keyboard navigation, Vercel cron jobs — standard patterns.
- **Phase 3:** Fuzzy-match label dedup, Drive move jobs — established patterns.
- **Phase 5:** Rule consolidation logic — internal business logic, no external API research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry 2026-04-24; official docs consulted for Neon, Prisma, Clerk, chokidar, Gmail API |
| Features | MEDIUM | Cortex's exact combination has no direct analogue; table stakes well-grounded; differentiator claims reasoned from first principles |
| Architecture | HIGH | Three-tier unidirectional pattern is standard; component boundaries confirmed against official Neon, Vercel, and Drive API docs |
| Pitfalls | MEDIUM | FSEvents and Gmail findings from community reports; RAG and pgvector pitfalls from production post-mortems; Drive rate limits from official docs |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Langfuse cloud platform version:** Verify whether Langfuse cloud has reached platform >= 3.95.0 before Phase 1 implementation; determines whether to pin SDK at v3 or upgrade to v4.
- **Google OAuth token storage on Mac:** keytar (native Keychain) vs encrypted JSON file — security decision with implementation consequences; needs explicit choice before Mac agent Phase 1 work begins.
- **chokidar 5 ESM in launchd context:** Confirm the agent package can run as "type": "module" under launchd, or fall back to chokidar v4 (CJS). Needs a 30-minute spike before committing to v5.
- **halfvec recall on real data:** The Neon halfvec benchmark uses synthetic data. Recall on Daniel's actual document distribution (invoices, contracts, emails) must be measured in Phase 4 before committing the index configuration.

## Sources

### Primary (HIGH confidence)
- https://nextjs.org/blog/next-16 — Next.js 16 release notes
- https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost — halfvec rationale and HNSW guidance
- https://neon.com/docs/extensions/pgvector — pgvector configuration
- https://developers.google.com/workspace/gmail/api/guides/sync — Gmail historyId sync behavior and 404 handling
- https://developers.google.com/workspace/drive/api/guides/limits — Drive API rate limits
- https://launchd.info — launchd KeepAlive daemon configuration
- npm registry — all version pins verified 2026-04-24

### Secondary (MEDIUM confidence)
- https://alwyns2508.medium.com/retrieval-augmented-generation-rag-in-production-what-actually-breaks-and-how-to-fix-it-5f76c94c0591 — RAG production failure patterns
- https://arxiv.org/html/2401.05856v1 — Seven RAG failure points
- https://www.dbi-services.com/blog/pgvector-a-guide-for-dba-part-2-indexes-update-march-2026/ — HNSW rebuild guidance
- https://github.com/maid/maid/issues/163 — FSEvents daemon silent death documentation
- https://issuetracker.google.com/issues/186391217 — Gmail historyId reliability reports

### Tertiary (LOW confidence)
- https://get.mem.ai/blog/switching-from-notion-to-mem — Mem.ai differentiator claims (vendor marketing)
- https://toolfinder.com/best/pkm-apps — PKM landscape overview (aggregator)

---
*Research completed: 2026-04-24*
*Ready for roadmap: yes*
