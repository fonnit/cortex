# Feature Landscape

**Domain:** Personal information management / AI triage / personal knowledge base
**Researched:** 2026-04-24
**Confidence:** MEDIUM — ecosystem well-surveyed; Cortex's specific combination (two-stage triage + emergent taxonomy + Drive-backed retrieval) has no direct analogue, so differentiator claims are reasoned from first principles rather than verified against a competitor doing the same thing.

---

## Table Stakes

Features users expect. Missing = product feels broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Ingest from primary sources | Without capture, there is nothing to manage | Low | Cortex: Downloads + Gmail only. Architecture must be pluggable but plugs stay unplugged. |
| Deduplication before processing | Duplicate items corrupt triage queues and waste LLM spend | Low | Content-hash dedup across sources; must run before classification |
| Relevance gate (keep / ignore) | Users need noise filtered before any taxonomy decision | Medium | First stage of two-stage pipeline; drives cost savings by aborting cheap before expensive |
| Label / category assignment | Users expect items to land somewhere, not in a flat dump | Medium | Second stage; proposes Drive path. Partial-match routing handles ambiguity. |
| Queue-based triage UI | Every comparable tool (Shortwave, Superhuman, iManage) exposes a triage queue as primary surface | Medium | Keyboard-first; inline expansion. Single-surface design (no separate card view) is the Cortex variant. |
| Keyboard navigation throughout | Power users (the only users at single-operator scale) expect keyboard-first | Low | Standard for operator tools; absence is a hard blocker for this persona |
| Confirm before filing | Auto-filing without confirmation erodes trust fast; every mature tool gates on user approval | Low | Triage UI is the approval gate. Uncertain items surface for human decision. |
| Natural-language retrieval | Query-by-concept is now expected in any AI-native tool; keyword search alone feels 2015 | Medium | Claude Haiku + pgvector semantic search. Sole retrieval surface by design. |
| Inline citations in answers | RAG systems without source attribution lose user trust; citations are now table stakes for any LLM-powered retrieval | Low | Sources linked in answer; user can navigate to Drive file |
| Auth + MFA | Single-user personal data system; missing MFA is a security red flag | Low | Clerk + Google OAuth |
| Delete / purge control | Users expect to own their data; no delete = legal and trust problem | Low | User-initiated only; cascades Drive blob + Neon rows + embeddings |

---

## Differentiators

Features that set Cortex apart. Not expected from generic tools, but high value for this use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Two-stage triage pipeline with separate rule systems | Competitors (Mem, Notion AI, Shortwave) use single-pass classification; a dedicated relevance gate stops noise before taxonomy decisions, reducing total LLM spend and keeping taxonomy clean | High | Each stage has own rules, queue, and routing logic. Interdependent: relevance gate must exist before label classifier. |
| Emergent taxonomy (zero pre-seeding) | Pre-seeded taxonomies impose schemas; Cortex's taxonomy grows from classifier output and user corrections. Compounds: the more items filed, the more accurate proposed paths become | High | Requires taxonomy management (rename, merge, split, deprecate with cascade). This is what makes the feedback loop real. |
| Feedback loop compounding (triage load trends down) | No comparable consumer tool promises that triage work decreases over time; most just make existing triage faster | High | Requires rule consolidation + deprecation jobs. Depends on taxonomy, label classifier, and rule system all working together. |
| Rule system with redundancy check and auto-consolidation | Shortwave/Superhuman filters grow stale and conflict; Cortex enforces a 20-rule cap and deprecates via jobs | Medium | Prevents rule rot. Depends on label classifier producing consistent label signals. |
| Drive as blob store (files accessible outside Cortex) | Competitors store in proprietary blobs (Rewind local disk, Mem cloud-only); Drive keeps files usable without Cortex | Low | Architecture decision already locked. Enables two-phase lifecycle (_Inbox → model-proposed path). |
| Size-band pre-read thresholds | Controls LLM cost without user involvement; installers get metadata-only, PDFs capped at 5 MB | Low | Upstream of classification; transparent to user. |
| Langfuse observability + admin metrics | Operator-grade visibility into classify/chunk/embed/ask costs; most personal tools offer none | Medium | Enables cost debugging and pipeline tuning. Depends on Langfuse SDK integration at every LLM call. |
| Tenancy-ready schema (single-user product, multi-user architecture) | Reduces future migration cost if Cortex ever opens to a second user | Low | Schema design decision; no UI work in MVP. |

---

## Anti-Features

Features to explicitly not build. Inclusion would harm product quality, compound complexity, or contradict core value.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Pre-seeded taxonomy | Imposes Daniel's past mental model at t=0; prevents the feedback loop from discovering actual structure from real ingest | Start empty; let classifier propose paths from first item forward |
| Manual search bar | A fallback search bar trains users to bypass NL retrieval; keeps the "is NL good enough?" question permanently unresolved | Force all retrieval through Claude; fix retrieval quality if it fails |
| Auto-deletion | Removes user agency; one false positive deletes something irreplaceable | User-initiated delete only; no TTL policies, no automatic purge |
| Auto-keep above size threshold | Large files get auto-kept without review; creates a garbage archive that grows without bound | Always route oversized items to human confirmation queue |
| Historical backfill at launch | Ingest of months of unstructured history floods the triage queue and breaks the feedback loop before it starts | Forward-only at launch; backfill script gated post-week-3 when taxonomy has initial structure |
| Auto entity merges | Silently merging entities (e.g. two taxonomy nodes) causes hard-to-debug path conflicts | Surface merge proposals; require explicit user approval |
| Fixed path templates | Rigid templates reproduce the failure mode of folder-based filing systems | Classifier proposes paths dynamically; templates never |
| Multi-user / billing | Adds surface area that kills MVP velocity; schema is ready, product is not | Single-operator first; tenancy added only if there is a second real user |
| Mobile-native app | Triage is a keyboard-first desktop workflow; a native app is wasted spend at this scale | Responsive web only |
| ColBERT reranker / structured extraction / compliance-grade retention | Engineering complexity with no marginal value for a single operator at 50 items/week | Ship without; add only if retrieval precision provably fails at scale |
| Collectors beyond Downloads + Gmail | Pluggable architecture exists; adding plugs before the core loop is proven dilutes focus | Keep plugs unplugged until triage feedback loop is compounding |
| Passive ambient capture (screen recording, always-on mic) | Rewind-style capture is high-privacy-risk and high-storage-cost for no proportional benefit given focused ingest sources | Explicit ingest only: Downloads watcher + Gmail poller |

---

## Feature Dependencies

```
Content-hash dedup
  → Relevance gate (relevance classifier)
    → Label classifier + proposed_drive_path
      → Rule system (predicates, prefilter, 20-rule cap, redundancy check)
        → Rule consolidation + deprecation jobs
      → Taxonomy management (rename, merge, split, deprecate, cascade)
        → Drive two-phase lifecycle (_Inbox → model path, cascading moves)
      → Triage UI (inline-expanding queue, keyboard-first, relevance + label modes)

Drive two-phase lifecycle
  → MCP search tool
    → Claude Haiku Q&A with inline citations

Langfuse traces
  → /admin metrics page

Clerk auth + MFA
  → All surfaces (triage UI, admin, retrieval)

User-initiated delete
  → Drive blob + Neon rows + embeddings (must cascade all three)
```

---

## MVP Recommendation

Prioritize (in dependency order):

1. Downloads + Gmail collectors with content-hash dedup
2. Two-stage triage pipeline (relevance gate → label classifier)
3. Triage UI with keyboard-first queue (relevance mode + label mode)
4. Drive two-phase lifecycle + taxonomy management primitives (rename, merge only — split + deprecate post-MVP)
5. Claude Haiku NL retrieval with inline citations

Defer:

- Rule consolidation + deprecation jobs — manual rule management is sufficient until rule count approaches cap
- /admin metrics page — Langfuse dashboard covers operator needs until a dedicated page is justified
- Backfill script — gated to post-week-3 per project spec
- Split + deprecate taxonomy operations — rename + merge cover the 80% case at launch

---

## Sources

- [Shortwave vs. Superhuman 2025 guide](https://www.baytechconsulting.com/blog/shortwave-vs-superhuman-the-2025-executives-guide-to-ai-email-clients) — MEDIUM confidence (editorial, not official docs)
- [iManage AI engine: auto document classification + NL questions (2023)](https://legaltechnology.com/2023/08/21/imanage-launches-ai-engine-for-automatic-document-classification-email-filing-and-natural-language-questions/) — MEDIUM confidence (announcement)
- [Mem.ai switching from Notion post](https://get.mem.ai/blog/switching-from-notion-to-mem) — LOW confidence (vendor marketing)
- [Rewind AI overview](https://insiderbits.com/technology/rewind-ai/) — LOW confidence (editorial)
- [RAG citation patterns — IBM](https://www.ibm.com/think/topics/retrieval-augmented-generation) — HIGH confidence (official)
- [AI document classification enterprise guide 2026](https://dmacq.com/dms+/resources/blogs/AI-Powered-Document-Classification-What-It-Is-and-Why-It-Matters) — MEDIUM confidence (vendor editorial)
- [Best PKM apps 2026 — toolfinder](https://toolfinder.com/best/pkm-apps) — LOW confidence (aggregator)
