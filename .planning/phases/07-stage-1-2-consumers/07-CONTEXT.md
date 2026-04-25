# Phase 7: Stage 1 & Stage 2 Consumers - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 2 grey areas accepted as-recommended

<domain>
## Phase Boundary

Two local consumer processes drain the queue end-to-end:
- **Stage 1 consumer** polls `GET /api/queue?stage=1&limit=10`, classifies relevance via `claude -p`, POSTs result to `/api/classify`
- **Stage 2 consumer** polls `GET /api/queue?stage=2&limit=2`, classifies labels (3-axis) via `claude -p` with current taxonomy context, POSTs result to `/api/classify`

Both consumers pass file paths (not content) to `claude -p`; Gmail items get a text prompt built from metadata. Both emit Langfuse traces spanning the full daemon → API → consumer → API loop.

**In scope:**
- New `agent/src/consumer/` directory: `stage1.ts`, `stage2.ts`, `index.ts`, plus shared `claude.ts` (execFile wrapper), `prompts.ts`, `semaphore.ts`
- New `agent/launchd/com.cortex.consumer.plist` (separate from daemon plist)
- New `app/api/taxonomy/internal/route.ts` — `requireApiKey`-guarded GET for the consumer to fetch taxonomy without Clerk
- Tests for the new consumer modules

**Out of scope:**
- Operational acceptance / soak — Phase 8
- Existing taxonomy/triage/admin Clerk-protected routes (untouched)
- Any UI changes
- Schema changes
- Daemon code (Phase 6 owns)
- Drive uploads (stays in Vercel cron)

</domain>

<decisions>
## Implementation Decisions

### Process layout
- **Single Node process, two worker pools.** One launchd plist (`com.cortex.consumer.plist`) starts the consumer. Inside, a Stage 1 pool (10 concurrent classifications) and a Stage 2 pool (2 concurrent classifications) run as parallel async loops sharing the same Langfuse instance, HTTP client, and env.
- **Concurrency primitive:** simple inline semaphore (small class, ~30 lines). No new deps. Pattern: a `Semaphore(n)` with `acquire()` returning a release function.
- **Code location:** `agent/src/consumer/` — separate dir within the existing `agent/` package. Shares package.json, tsconfig, jest config with the daemon.
- **launchd plist:** `agent/launchd/com.cortex.consumer.plist` — separate from daemon plist. KeepAlive=true, ThrottleInterval=10, StandardOutPath/ErrorPath separate logs (`/tmp/cortex-consumer.{out,err}.log` or similar). Same env vars as daemon (CORTEX_API_URL, CORTEX_API_KEY, Langfuse) plus Anthropic API access via `claude` CLI.

### `claude -p` invocation
- **Mechanism:** `execFile('claude', ['-p', prompt], { timeout: 120_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } })`. Use `execFile` (not `spawn` with shell, never `exec`) to prevent argv injection. Allowlist env vars.
- **Stage 1 prompt (file items):**
  ```
  Classify this file: "${absolutePath}". Read the file with the Read tool to see content.

  Decide: keep (relevant professional document), ignore (junk/spam/installer), or uncertain.

  Respond JSON only: {"decision": "keep"|"ignore"|"uncertain", "confidence": 0..1, "reason": "..."}.
  Confidence ≥ 0.75 required for actionable keep/ignore; else respond uncertain.
  ```
- **Stage 1 prompt (Gmail items):** No file path. Use metadata text:
  ```
  Classify this email:
  Subject: ${subject}
  From: ${from}
  Preview: ${snippet}
  Headers: ${selected headers as JSON}

  Decide: keep / ignore / uncertain. Respond JSON: {"decision":..., "confidence":..., "reason":...}.
  ```
- **Stage 2 prompt (file or Gmail):**
  ```
  Classify this item: ${file: "Read ${absolutePath}" | gmail: <metadata block>}.

  Existing taxonomy:
  Type axis: ${typeLabels.join(', ')}
  From axis: ${fromLabels.join(', ')}
  Context axis: ${contextLabels.join(', ')}

  Propose 3-axis labels (use an existing label if confident match ≥ 0.85; else null with low confidence).
  Compute proposed_drive_path: e.g., "/<type>/<from>/<context>/<filename>" using your best mapping.

  Respond JSON: {"axes": {"type":{"value":string|null,"confidence":0..1}, "from":{...}, "context":{...}}, "proposed_drive_path":string}.
  ```
- **Output parsing:** match `\{[\s\S]*\}` regex on stdout; `JSON.parse`; validate with Zod. On parse failure, non-zero exit, or timeout: POST `/api/classify` with `outcome: 'error', error_message: ...`. The queue's retry-cap handles retries.
- **Timeout:** 120s per `claude -p` invocation. Hard kill on exceed.
- **Stderr:** captured and logged into Langfuse trace metadata; never POSTed verbatim to API (avoid leaking secrets).

### Taxonomy access for Stage 2
- **New route:** `app/api/taxonomy/internal/route.ts` — GET only, guarded by `requireApiKey` (same pattern as the queue route). Returns `{ type: string[], from: string[], context: string[] }` — flat arrays of non-deprecated label names. No Clerk dependency.
- The existing Clerk-protected `/api/taxonomy/route.ts` is left untouched.
- Stage 2 consumer fetches taxonomy at the start of each batch (max 2 items per poll, so 1 fetch per ~30s cadence is fine — no caching needed).

### Polling cadence
- **Stage 1 poll interval:** 5 seconds when items present, 30 seconds when queue is empty (backoff). Max 10 items per poll.
- **Stage 2 poll interval:** 5 seconds when items present, 30 seconds when empty. Max 2 items per poll.
- After each poll, run all returned items concurrently up to the pool cap, then poll again.

### Error path
- **Per-item failure** → POST classify with `outcome: 'error'`. Server queue handles retry/cap.
- **API connectivity loss** → exponential backoff retry (reuse `agent/src/http/client.ts` `postIngest` pattern? probably need a `postClassify` helper). After max retries, log to Langfuse and continue with next item; the item stays in `processing_*` and will be reclaimed by the API stale-claim path.
- **`claude` CLI not on PATH at startup** → exit 1 with explicit error message.
- **Anthropic API errors** (e.g., rate limit surfacing through `claude -p`) → retry once after 30s sleep within the consumer; second failure returns to queue as `outcome: 'error'`.

### Langfuse traces
- Each consumer maintains a parent trace per cycle (`name: 'consumer-stage1'` / `'consumer-stage2'`).
- Per-item: a span under the parent trace with `claude_invocation` sub-span, `api_classify` sub-span, item id metadata.
- Trace ID from the `X-Trace-Id` header returned by `/api/queue` is used as the parent — true end-to-end traceability (daemon ingest → API → consumer claim → consumer classify → API).

</decisions>

<canonical_refs>
- `app/api/queue/route.ts` (Phase 5) — what consumers poll
- `app/api/classify/route.ts` (Phase 5) — what consumers POST results to
- `lib/api-key.ts` (Phase 5) — auth helper for new internal taxonomy route
- `app/api/taxonomy/route.ts` (Phase 3) — reference structure (NOT to be modified, just to copy data shape)
- `agent/src/http/client.ts` (Phase 6) — fetch+retry pattern to reuse for `postClassify`
- `INGEST-REARCHITECT-BRIEF.md` (root)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- `agent/src/http/client.ts` exports `postIngest`, `postHeartbeat` — needs new `postClassify` and `getQueue` and `getTaxonomyInternal` helpers (same auth/retry semantics)
- `agent/src/http/types.ts` — define `ClassifyRequest` and `QueueItem` types
- `app/api/queue/route.ts` response shape: `{ items: [{ id, source, filename, mime_type, size_bytes, content_hash, source_metadata, file_path? }], reclaimed: N }` — consumer must handle each variant
- `lib/queue-config.ts` — status string constants if needed
- `langfuse@3.38.20` — use the same trace pattern from existing routes

### Established patterns
- ESM module style, `"type": "module"` in agent/package.json
- Native fetch (Node 22 LTS)
- Bearer auth header verbatim from cron and ingest routes
- Zod validation on all incoming/outgoing JSON
- Langfuse trace + span + flushAsync at end of each cycle

### Integration points
- `claude` CLI must be installed and on PATH where the consumer runs. Likely already true on Daniel's Mac since he's using Claude Code.
- `~/.config/claude/` may need Claude API credentials configured separately if `claude -p` requires authentication beyond the local CLI

### Anti-patterns to AVOID
1. **Do NOT pass file content as argv** — only file paths, only via execFile, never via shell
2. **Do NOT use Clerk on the new internal taxonomy route** — `requireApiKey` only
3. **Do NOT modify existing taxonomy/triage/rules/admin routes**
4. **Do NOT create a parallel queue/classify route** — consumers call the existing Phase 5 routes
5. **Do NOT block the Stage 1 pool waiting for Stage 2 capacity** — they're independent
6. **Do NOT cache taxonomy across polls** for Stage 2 — fresh fetch each batch (taxonomy changes during operation)
7. **Do NOT store classification results locally** — POST to API, server is source of truth

</code_context>

<specifics>
## Specific Ideas

- **Concurrency=1 enforcement on POST /api/classify** is the API's responsibility (Phase 5 already added optimistic-concurrency `where: { id, status: 'processing_stageN' }` after the code review fix). Stale-reclaim returns 409 Conflict — consumer should treat that as "give up on this item" (don't retry; it'll come back through the queue).
- **`claude` CLI environment:** the consumer runs the CLI in a subprocess. Anthropic API key access is whatever the CLI is configured for on the operator's machine (`claude login` or env var). Consumer should not handle Anthropic credentials directly.
- **Identity context (from v1.0 `agent/src/pipeline/identity.ts` which we deleted):** v1.0 fetched an identity context block to inject into prompts. That logic is out of scope for v1.1 — not in the brief, and the deletion was deliberate. If the user wants it back, that's a future phase.
- **`postClassify` retry** must NOT retry on 4xx (e.g., 409 Conflict from optimistic-concurrency guard) — only 5xx/429/network. Same pattern as `postIngest`.

</specifics>

<deferred>
## Deferred Ideas

- Identity-context block in prompts — v1.0 had it; out of scope for v1.1 (not in brief). Future phase if Daniel wants it.
- Pre-filter rules in classification prompts — RUL-* requirements were Phase 3 (v1.0); rule loading happens server-side in v1.0. Not re-implementing here.
- Worker threads / cluster — single async process is enough for max 12 concurrent claude invocations; if quota becomes a bottleneck later, scale by adjusting pool sizes
- Structured backoff coordination across pools — independent for now
- Local cache of classification results — explicitly out of scope; API is single source of truth

</deferred>
