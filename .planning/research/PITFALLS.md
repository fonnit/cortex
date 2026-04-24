# Domain Pitfalls: Cortex

**Domain:** AI-native personal information management with LLM classification, emergent taxonomy, Drive blob store, pgvector retrieval, Mac daemon ingest
**Researched:** 2026-04-24
**Confidence:** MEDIUM (daemon + Gmail findings from community reports; RAG/pgvector findings from production post-mortems; Drive API from official docs)

---

## Critical Pitfalls

Mistakes that cause rewrites or invalidate the core RAT test.

---

### Pitfall 1: The Feedback Loop Trends Flat, Not Down

**What goes wrong:** Weekly triage load stays constant or grows. The classifier keeps routing to `uncertain` because rules never consolidate into coverage, and Daniel never sees evidence that the system is learning.

**Why it happens:** The rule consolidation job runs but produces rules with overlapping predicates. New rules cover new edge cases but don't retire the narrow rules they generalize. The 20-rule cap is hit; new patterns get dropped. The classifier uses rules but accumulates no compounding signal.

**Consequences:** Core value proposition ("load trends down") never materializes. Project gets abandoned as a fancy label-making tool.

**Prevention:**
- Track `uncertain_rate` and `auto_filed_rate` as primary metrics from day one, not as a phase-N concern. Surface them on /admin.
- Define "trending down" concretely: uncertain_rate drops ≥5% week-over-week for 3 consecutive weeks = passing RAT. Flat = failing.
- The consolidation job must emit a structured diff: rules merged, rules deprecated, coverage delta. If a consolidation run produces 0 merges for 2 consecutive weeks, that is a signal the rule schema is wrong, not that the taxonomy is mature.
- Weekly consolidation is too slow for early-stage learning. Run consolidation after every 50 triage decisions in the first 30 days.

**Warning signs:** `uncertain_rate` doesn't drop after week 2; rule count hits cap before week 4; Daniel begins manually overriding labels more than accepting them.

**Phase:** Address in Phase 1 (classification pipeline). Instrument before shipping triage UI.

---

### Pitfall 2: Taxonomy Fragmentation via Emergent Drift

**What goes wrong:** After 6 weeks the taxonomy has 40 labels. "Invoices", "Invoice-2024", "billing", "Receipts-stripe", "stripe-billing" all coexist. Every classifier call sees a different label list. Retrieval returns items under three different labels when asked "show me invoices." Merge proposals never fire because no merge threshold was defined.

**Why it happens:** The classifier proposes paths. Each proposal is slightly different. Without a deduplication pass on proposed labels before insertion, the taxonomy grows unbounded. "No pre-seeded taxonomy" is not the same as "no constraints on label creation."

**Consequences:** Retrieval breaks down. User loses trust. Taxonomy management becomes a manual tax.

**Prevention:**
- Before creating a new label, the classifier must fuzzy-match the proposed label against the existing taxonomy (Levenshtein + embedding similarity). If match score > 0.85, propose the existing label instead.
- Set a hard taxonomy size limit for MVP: 50 labels. Force a consolidation pass if exceeded.
- Taxonomy merge proposals must surface automatically in the triage UI when cosine similarity between two label embeddings exceeds 0.90.
- Treat label creation as a write-heavy operation with a confirmation gate, not a side effect of classification.

**Warning signs:** Label count grows faster than item count week-over-week; retrieval returns items with different labels for the same semantic concept; Daniel stops using taxonomy management because it's too noisy.

**Phase:** Address in Phase 1 (taxonomy schema). Cannot be retrofitted after 200+ items.

---

### Pitfall 3: Silent Retrieval Degradation

**What goes wrong:** Haiku answers questions confidently with stale or wrong chunks. The system feels broken but there's no error — the embeddings are just misaligned with how Daniel now asks questions. Nobody knows because there's no retrieval quality measurement.

**Why it happens:** RAG systems degrade silently. Queries evolve (Daniel's vocabulary shifts, new domains enter). Embeddings for old items were generated against a different distribution. The HNSW index isn't rebuilt after bulk ingestion. Nobody added recall@k tracking because "it works in demo."

**Consequences:** The sole retrieval surface (Claude/Haiku) starts hallucinating from bad chunks. Trust collapses. Users abandon retrieval and go back to manual search — but manual search was explicitly excluded from the product.

**Prevention:**
- Instrument every retrieval call via Langfuse: query embedding, top-k doc IDs, similarity scores, Haiku's cited doc IDs. This is non-negotiable from day one.
- Define a baseline query set (10-15 questions Daniel actually asks) and run them weekly. Flag any week where average similarity score drops >10% from prior week.
- Rebuild HNSW index after bulk ingestion events (>100 items). Never rely on incremental index updates after bulk re-inserts.
- Chunk strategy must be document-type-aware, not fixed-size. Emails: subject+body as single unit. PDFs: section-aware with header propagation. Flat chunking of PDFs destroys retrieval quality.

**Warning signs:** Haiku cites documents that don't match the answer; similarity scores trend down over 2 weeks; "no relevant results" rate increases.

**Phase:** Address in Phase 2 (retrieval/search). Instrumentation in Phase 1 (observability).

---

### Pitfall 4: Compounding Classification Errors from Two-Stage Architecture

**What goes wrong:** The relevance gate passes something it shouldn't. The label classifier then assigns a confident label. The item enters Drive with a wrong path. A taxonomy rename later cascades a move to the wrong folder. The item is now effectively lost.

**Why it happens:** Two-stage pipelines multiply error rates. If relevance gate is 90% accurate and label classifier is 90% accurate, combined accuracy is 81%. Errors in stage 1 cannot be corrected by stage 2. Uncertain routing exists but the threshold for `uncertain` is set too aggressively to avoid queue overload.

**Consequences:** Incorrectly filed items accumulate silently. When Daniel searches for something, it's missing or in the wrong place. The audit trail doesn't surface the error because both stages returned high-confidence outputs.

**Prevention:**
- Store the full classification trace (stage 1 output, stage 2 output, confidence scores, rule matches) in Langfuse AND as a JSON column on the item row. Never discard intermediate state.
- Route to `uncertain` whenever either stage confidence is below 0.75, not just when the label classifier is unsure. The relevance gate gets a veto.
- Add a "re-classify" action to the triage UI. Items that Daniel corrects must trigger a rule proposal, not just a metadata update.
- Audit Drive paths weekly: any item in `_Inbox` older than 7 days is a classification failure. Surface these on /admin.

**Warning signs:** Items accumulate in `_Inbox` without moving to final paths; Daniel corrects the same type of item repeatedly without the rule system learning; stage 1 confidence scores cluster near the threshold.

**Phase:** Address in Phase 1 (classification pipeline design). The trace storage is non-negotiable at schema time.

---

### Pitfall 5: Gmail historyId Expiry Causing Silent Message Gaps

**What goes wrong:** The daemon polls Gmail incrementally via historyId. The Mac sleeps for 3 days. When it wakes, the stored historyId is expired (validity is "at least a week but sometimes only a few hours"). The API returns 404. The daemon logs an error and skips to current. 3 days of email is silently dropped.

**Why it happens:** Gmail historyId is not a durable cursor. Its validity is documented as probabilistic. Polling daemons that don't handle 404 with a full-sync fallback silently drop history.

**Consequences:** Items Daniel expects to be in Cortex are missing. Trust collapses on the collector, which is the input surface for the entire system.

**Prevention:**
- Treat historyId expiry (404) as a first-class state, not an error. On 404, perform a full sync from `after:` date using the last-known-good timestamp, not a full Gmail history walk.
- Store `last_successful_poll_at` as a timestamp, separate from `last_history_id`. Use the timestamp as the fallback sync window.
- Emit a Langfuse event for every full-sync fallback. More than 1 fallback per week = polling interval is too long or Mac sleep behavior is disrupting the daemon.
- The daemon must survive launchd restarts without losing state. Persist `last_history_id` and `last_successful_poll_at` to Neon, not to a local file.

**Warning signs:** Daemon logs show 404 responses; items from specific date ranges are missing from the queue; full-sync fallbacks appear in Langfuse more than once per week.

**Phase:** Address in Phase 1 (collector). This is a correctness requirement, not an optimization.

---

### Pitfall 6: FSEvents Daemon Stops Responding After Hours

**What goes wrong:** The Downloads watcher runs fine for the first hour after boot, then silently stops processing new files. Files accumulate in Downloads. Daniel doesn't notice for days.

**Why it happens:** Documented behavior: macOS FSEvents-based daemons can stop responding to watch rules after ~1 hour of runtime. The internal event queue may overflow or the kernel path table can be exhausted under certain conditions. The launchd plist keeps the daemon process alive, but the event subscription has silently died.

**Consequences:** The Downloads collector fails without any error signal. Items from Downloads are completely missing from the queue.

**Prevention:**
- Implement a heartbeat check: the daemon must log a "still watching" event every 5 minutes via Langfuse. If the heartbeat stops, alert via a launchd `OnDemand` restart trigger or a local push notification.
- Add a polling fallback: every 15 minutes, stat the Downloads directory mtime and compare against last-known. If mtime changed but no FSEvent was received in that window, trigger a directory scan. FSEvents should be primary; polling is the safety net.
- Set `KeepAlive: true` in the launchd plist AND implement startup recovery: on daemon init, scan Downloads for items newer than `last_processed_at` to catch any files missed during downtime.
- Test the daemon specifically after 2+ hours of idle then a burst of file additions. This failure mode only surfaces under real conditions.

**Warning signs:** No FSEvents in Langfuse for >10 minutes while Mac is active; items appear in Downloads but not in triage queue; daemon process running but heartbeat absent.

**Phase:** Address in Phase 1 (collector). The heartbeat is mandatory before declaring the collector stable.

---

### Pitfall 7: Drive Cascading Move Failures During Taxonomy Operations

**What goes wrong:** Daniel renames a taxonomy label. Cortex initiates a cascade move for 80 files from old path to new path. Drive API rate limit fires at item 40 (3 write ops/sec sustained). The cascade halts at 40/80. The other 40 remain at the old path. The old label is now deprecated. Those 40 items are orphaned.

**Why it happens:** Drive API write operations are soft-limited at 3/sec sustained. Bulk rename operations are not atomic. There is no built-in rollback. The Drive API returns 429 or 403 on quota exceeded and does not queue the remaining operations.

**Consequences:** Items orphaned in deprecated paths. Retrieval returns them under the wrong label. Taxonomy integrity is broken.

**Prevention:**
- All cascade moves must be tracked as a job with item-level state in Neon: `pending`, `moved`, `failed`. Never fire-and-forget.
- Use exponential backoff starting at 500ms with jitter. Cap at 32 seconds. Retry failed items 3 times before marking as `failed` and surfacing in /admin.
- Rate-limit cascade move operations at 2/sec (below the 3/sec soft limit) with a configurable burst allowance.
- The taxonomy rename must not mark the old label as deprecated until all cascade moves in the job reach `moved` status. Orphan prevention is a schema constraint, not an application check.
- Show cascade move progress in the taxonomy management UI. Do not let the user initiate a second cascade on the same taxonomy while one is in flight.

**Warning signs:** Items found at deprecated Drive paths in weekly audits; cascade move jobs with >0 `failed` items; Drive quota errors in Langfuse.

**Phase:** Address in Phase 2 (taxonomy + Drive lifecycle). The job schema must be defined in Phase 1 migrations.

---

### Pitfall 8: halfvec Recall Degradation Under Specific Query Patterns

**What goes wrong:** halfvec (512 dims, 16-bit) works well in benchmarks. In production, queries about financially dense documents (invoices, contracts with numbers) return wrong results at a higher rate than expected because numerical distinctions compress poorly in half-precision.

**Why it happens:** Binary quantization is documented as insufficient for 1536-dim embeddings. Cortex uses 512 dims (not 1536), which is a different tradeoff. But half-precision still loses information on numerically dense content. The HNSW index at 512 dims with halfvec is fast, but recall is not guaranteed to match fullvec recall across all content types.

**Consequences:** Retrieval silently degrades for a specific content class. Daniel asks "show me the AWS invoice from March" and gets a different invoice.

**Prevention:**
- Run a recall@10 baseline during Phase 2 using 20+ representative queries covering all document types (emails, PDFs, invoices, research docs). Compare halfvec vs fullvec recall. If halfvec recall is >2% worse on any document type, upgrade to fullvec for that content type.
- The embedding schema must support a `vector_type` column from day one so fullvec and halfvec can coexist if needed.
- Do not assume the Neon halfvec benchmark results generalize to Daniel's actual document distribution. Benchmark on real data.

**Warning signs:** Retrieval quality drops for specific document types while remaining good for others; similarity scores for known-relevant docs fall below 0.7.

**Phase:** Address in Phase 2 (retrieval). Schema flexibility from Phase 1.

---

## Moderate Pitfalls

---

### Pitfall 9: Content-Hash Dedup Misses Semantically Identical Items

**What goes wrong:** The same invoice arrives as an email attachment and as a manually downloaded PDF. Content hashes differ (metadata differs). Both enter the pipeline. Two copies of the same item get filed, embedded, and appear in retrieval.

**Why it happens:** Content-hash dedup is exact-match only. Different delivery channels produce different byte sequences for the same semantic document.

**Prevention:** Content-hash dedup is correct for exact duplicates (re-downloaded same file). For cross-channel duplicates, add a semantic similarity check during the label classifier stage: if a newly ingested item embeds within cosine distance 0.05 of an existing item with the same proposed_drive_path, surface a dedup proposal to the triage UI rather than auto-filing.

**Phase:** Phase 1 schema (add `near_duplicate_of` FK), Phase 2 implementation.

---

### Pitfall 10: Size-Band Pre-Read Thresholds Cause Misclassification of Large Legitimate Items

**What goes wrong:** A 7MB PDF is a critical contract. The classifier sees metadata only (filename, MIME type, email subject). It files it as "Documents/Misc" instead of "Legal/Contracts". Daniel finds it 3 weeks later in the wrong place.

**Why it happens:** The size-band thresholds (PDF 5MB → metadata-only) are conservative but they create a blind spot for large files that carry critical content.

**Prevention:** The size-band read strategy must be configurable per MIME type, not global. For PDFs where subject/sender signals suggest high value (keywords: "contract", "agreement", "invoice", "statement"), override the size threshold and extract at least the first 2 pages regardless of total size. Store the extraction strategy used as metadata on the item.

**Phase:** Phase 1 (collector/extractor).

---

### Pitfall 11: Clerk Auth Token Expiry Breaking the Mac Agent

**What goes wrong:** The Mac daemon's Clerk session token expires after 24 hours. The daemon doesn't detect the 401 response correctly. It keeps "processing" with silent failures — classification calls succeed (Claude CLI uses its own auth) but write calls to the Neon API return 401 and are dropped silently.

**Prevention:** The Mac agent must treat any 401 from the web API as a fatal error, halt processing, and emit a local notification prompting re-authentication. Never swallow 401s in the daemon. Build a health-check endpoint that the daemon calls on startup and every hour.

**Phase:** Phase 1 (daemon architecture).

---

## Minor Pitfalls

---

### Pitfall 12: Keyboard Navigation Trap in Inline-Expanding Cards

**What goes wrong:** The keyboard-first triage UI works for linear traversal but traps focus inside an expanded card when the user wants to navigate to the next item without collapsing. Standard tab sequence breaks.

**Prevention:** Implement keyboard navigation spec before UI implementation: `j/k` for queue navigation regardless of expansion state; `Space` to expand/collapse; `Enter` to confirm; `u` to mark uncertain; `Esc` to collapse. Test with keyboard-only from day one.

**Phase:** Phase 2 (triage UI).

---

### Pitfall 13: Langfuse Trace Volume Causing Neon Connection Saturation

**What goes wrong:** Every classify/chunk/embed/ask call emits a Langfuse trace. At 50+ items/week with multi-step pipelines, trace volume generates connection pressure on Neon during ingestion bursts.

**Prevention:** Langfuse uses its own backend — traces do not hit Neon directly. However, the Mac daemon's Neon write calls (item creation, rule updates, embedding inserts) should be batched per-item, not per-pipeline-step. Use a single transaction per item lifecycle event.

**Phase:** Phase 1 (daemon architecture).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Collector (Phase 1) | FSEvents silent death | Heartbeat + polling fallback |
| Gmail polling (Phase 1) | historyId expiry gaps | 404 → full-sync with timestamp fallback |
| Classification pipeline (Phase 1) | Two-stage error multiplication | Full trace storage; uncertain threshold on both stages |
| Taxonomy schema (Phase 1) | Fragmentation via emergent drift | Fuzzy-match on label creation; hard size limit |
| Drive lifecycle (Phase 2) | Cascade move orphaning | Job-level tracking with item state; rate limit at 2/sec |
| Retrieval (Phase 2) | Silent embedding degradation | Baseline queries; recall@10 weekly |
| halfvec (Phase 2) | Recall loss on dense content | Benchmark on real data before committing |
| Feedback loop (ongoing) | Flat uncertain_rate | Instrument from day 1; RAT threshold defined upfront |

---

## Sources

- RAG production failures: [RAG in Production: What Actually Breaks](https://alwyns2508.medium.com/retrieval-augmented-generation-rag-in-production-what-actually-breaks-and-how-to-fix-it-5f76c94c0591)
- Seven RAG failure points: [Seven Failure Points in RAG](https://arxiv.org/html/2401.05856v1)
- pgvector halfvec tradeoffs: [Neon halfvec blog](https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost)
- HNSW index rebuild: [pgvector DBA guide](https://www.dbi-services.com/blog/pgvector-a-guide-for-dba-part-2-indexes-update-march-2026/)
- Drive API rate limits: [Drive API Usage Limits](https://developers.google.com/workspace/drive/api/guides/limits) | [FolderPal rate limit guide](https://folderpal.io/articles/how-to-handle-google-drive-api-rate-limits-for-bulk-folder-copying-and-automation)
- Gmail historyId reliability: [Gmail sync guide](https://developers.google.com/workspace/gmail/api/guides/sync) | [historyId issues thread](https://issuetracker.google.com/issues/186391217)
- FSEvents daemon reliability: [maid daemon issue](https://github.com/maid/maid/issues/163) | [fsevents library notes](https://github.com/fsnotify/fsevents)
- LLM feedback loop degradation: [Model collapse research](https://arxiv.org/pdf/2511.05535) | [LLM system failure taxonomy](https://arxiv.org/abs/2511.19933)
- Semantic search architecture: [Semantic Search Is an Architecture Problem](https://dev.to/oozioma/semantic-search-is-an-architecture-problem-5h8l)
