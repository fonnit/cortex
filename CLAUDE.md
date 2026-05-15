# Cortex

A personal AI-native information system that captures everything Daniel receives across Downloads and (later) Gmail, learns his filing system from how he reacts to items, and answers anything in plain English from any device. Single-operator tool, not a product — no User table, no userId scoping; any authenticated Clerk session is the owner.

**Core value:** the triage feedback loop compounds fast enough that weekly triage load trends down, not flat or up — Cortex learns to file so Daniel doesn't have to. Once an item is filed, its text is RAG-retrievable from `/ask` so the archive answers questions, not just stores files.

## Current scope (v2)

Manual `cortex add <file>` → Mac worker extracts text (Vision OCR for images and scan-only PDFs, pdf-parse for PDFs with a text layer, mammoth for DOCX) → Haiku classify (text-mode only) returns `{proposals, suggestedFilename}` → human reviews in `/triage`, edits filename if desired, approves → worker moves the file into `~/Documents/CortexArchive/<folder>/<finalFilename>.<ext>` (iCloud-synced) → embed loop chunks the extracted text and writes `ItemChunk` halfvec(512) rows → `/ask` retrieves top-k by similarity and synthesizes an answer with citations.

**Out of scope:** Gmail ingest, Drive blob store, chokidar watcher, MCP server, ItemFact / structured extraction, Langfuse / observability.

Design docs live at `~/.gstack/projects/fonnit-cortex/` — the most recent (`dfonnegrag-main-design-20260515-010949.md`) is the v2 spec.

## Constraints

- **Storage:** Neon Postgres only — no SQLite, no in-memory stores.
- **Migrations:** Prisma 7 through Vercel build, never locally.
- **Auth:** Clerk with MFA for browser routes; Clerk Machine Tokens (per-machine `ak_` secret + per-request `mt_` token via `clerkClient.m2m.createToken`/`verify`) for the Mac worker. Worker mints; backend verifies with its own machine secret.
- **Worker boundary:** the Mac worker uses the HTTP API only. It does NOT have `DATABASE_URL`. All DB access goes through backend routes.
- **Move target:** `~/Documents/CortexArchive/<folder.path>/<finalFilename>.<ext>`. iCloud-synced via the macOS "Desktop & Documents Folders" toggle; backup is automatic.
- **Text extraction:** macOS Vision OCR runs on the Mac via a Swift binary (`agent/macos-bin/`) for images and scan-only PDFs. PDFs with a text layer use `pdf-parse`; DOCX uses `mammoth`. Every supported file becomes plain text before Haiku sees it — no multimodal content blocks in v2.
- **Classification:** Claude Haiku 4.5 via `@anthropic-ai/sdk`, text-mode input only. Returns `{proposals, suggestedFilename}` (lowercase-kebab). After 2026-06-15 Claude CLI subscription billing ends; Max subscribers get $100/mo API credits which covers Cortex spend (~$5-50/year) many times over.
- **Embeddings:** OpenAI text-embedding-3-small, 512 dims, halfvec in pgvector. Worker chunks the full `Item.extractedText` (~800 tokens with 100 overlap) and POSTs `/api/items/[id]/chunks`, which inserts via single-statement `unnest` CTE. Per-stage lease columns (`chunkLeasedAt`, `chunkAttempts`) keep embed independent of classify/move retries.
- **Q&A:** `POST /api/ask` embeds the question via OpenAI on Vercel, runs pgvector top-k (`<=>` halfvec operator) against `ItemChunk`, synthesizes via Haiku with structured `{answer, citationChunkIds}` JSON, resolves citation IDs back to retrieved hits. UI is `/ask`.
- **Observability:** `lib/trace.ts` is a noop wrapper. LangSmith plug if observability surfaces a need (TODO in `TODOS.md`).

## Stack

| Layer | Package | Version | Notes |
|---|---|---|---|
| Web framework | next | 16.2.4 | App Router. RSC + Server Actions for the triage UI. |
| UI runtime | react | 19.2.5 | React Compiler stable; no manual memo/callback noise. |
| Types | typescript | 6.0.3 | Prisma client + Zod schema narrowing. |
| Styling | tailwindcss | 4.2.4 | CSS-first theming. |
| Server-state | @tanstack/react-query | 5.100.1 | Optimistic updates in triage. |
| Validation | zod | 4.3.6 | API bodies, classifier output, folder names. |
| Auth | @clerk/nextjs | 7.2.5 | User session + Machine Tokens (worker). |
| ORM | prisma | 7.8.0 | Edge-runtime via Neon adapter. |
| DB driver | @prisma/adapter-neon | 7.8.0 | HTTP transport for Vercel Functions. |
| DB driver (raw) | @neondatabase/serverless | 1.1.0 | Used directly for `prisma.$queryRaw` on hot paths and for the SELECT FOR UPDATE SKIP LOCKED claim. |
| LLM | @anthropic-ai/sdk | 0.91.0 | Direct SDK calls in `agent/classify.ts`. No subprocess. |
| File watcher | chokidar | — | v2 only (v1 uses manual `cortex add`). |
| Worker runtime | Node.js | 22 LTS | Mac launchd, KeepAlive=true. |
| Text extract | pdf-parse, mammoth | latest | PDF (text layer) + DOCX. `.heic` via macOS `sips`. |

## Engineering patterns to honor

These were earned the hard way in recent commits. Don't regress them.

- **Prisma over Neon HTTP transport, not WebSocket.** Use `prisma.$queryRaw` for hot paths (vector queries, claim route, chunks insert, ask retrieval). Multi-statement `$transaction` blocks over HTTP are problematic; keep transactions single-statement where possible. The chunks route uses a single CTE-based statement combining `INSERT INTO "ItemChunk"` + `UPDATE "Item"` to stay within the rule.
- **No Langfuse fire-and-forget pitfalls** — Langfuse is dropped. `lib/trace.ts` is a noop wrapper for future provider swap.
- **Worker token via Clerk Machine Token, not bespoke bearer.** Worker has its own `ak_` Machine Secret in `agent/.env.daemon` (`CLERK_MACHINE_SECRET_KEY`); per request it mints a short-lived `mt_` token via `clerkClient.m2m.createToken` and sends `Authorization: Bearer mt_...`. Backend has a SEPARATE `ak_` (one for `cortex-backend` machine in the Clerk dashboard) and verifies the token via `clerkClient.m2m.verify` with its own secret. Dashboard scope `cortex-worker → cortex-backend` must exist. `agent/src/clerk-m2m.ts` caches `mt_` until 60s before expiry and uses an in-flight singleton so concurrent worker loops don't all re-mint at once.
- **All worker DB access goes through API routes.** No DATABASE_URL on the worker. Worker reads taxonomy via `GET /api/taxonomy` (ETag-cached, returns folders + sampleFilenames), claims items via `POST /api/items/claim` (server-side SELECT FOR UPDATE SKIP LOCKED + UPDATE returning, per-stage lease columns), posts classification via `POST /api/items/[id]/classification`, posts file-move completion via `POST /api/items/[id]/moved`, posts chunks via `POST /api/items/[id]/chunks`.
- **Three concurrent worker loops, not lockstep.** `agent/src/worker.ts` runs `classification`, `move`, and `embed` via `Promise.all([runLoop('classification'), runLoop('move'), runLoop('embed')])`. Per-stage lease columns prevent racing on the same Item: classify+move share `leasedAt`/`attempts` (sequential per-item lifecycle), embed has its own `chunkLeasedAt`/`chunkAttempts`.
- **Middleware route matchers must list every worker route.** `middleware.ts` enumerates worker routes via `createRouteMatcher`. Anything not listed defaults to user-session-protect and returns the sign-in HTML to a Bearer-only worker request. When adding a new worker endpoint, update both the route file AND the matcher.
- **Status transitions through `lib/transition-item.ts`.** Mutation routes (move, reject) share one helper that runs `$transaction → check allowed-from-state → write Decision row → update Item`. Approve and create-folder have their own transactions because they walk new folder paths via `ensureFolderPath`.
- **Filename handling.** Haiku returns `suggestedFilename` (lowercase-kebab, no extension). Server-side, mutation routes sanitize via `lib/final-filename.ts` (strip extension, allowlist, length cap). Worker reappends `extname(sourcePath)` on move.

## File layout

```
/agent                                       # Mac worker process
  src/worker.ts                              # three concurrent loops (classify + move + embed)
  src/cortex-add.ts                          # CLI
  src/classify.ts                            # Anthropic SDK + Haiku, text-mode only
  src/embed.ts                               # chunkText + OpenAI batch embeddings
  src/clerk-m2m.ts                           # mt_ token mint + cache + in-flight singleton
  src/text-extract.ts                        # pdf-parse / mammoth / Vision OCR dispatcher
  src/taxonomy-cache.ts                      # ETag-cached folders + sampleFilenames
  macos-bin/                                 # Swift Vision OCR binary (built once via npm run build:ocr)
  launchd/com.cortex.daemon.plist            # launchd service file
/app
  /(app)/triage/page.tsx                     # triage UI
  /(app)/ask/page.tsx                        # Q&A UI
  /api/items/route.ts                        # POST: enqueue from CLI
  /api/items/claim/route.ts                  # POST: worker claim (per-stage SELECT FOR UPDATE SKIP LOCKED)
  /api/items/[id]/classification/route.ts    # POST: worker posts classify result + extractedText
  /api/items/[id]/chunks/route.ts            # POST: worker posts ItemChunk halfvec batch
  /api/items/[id]/moved/route.ts             # POST: worker reports file moved
  /api/items/[id]/approve/route.ts           # POST: triage approve (Clerk session)
  /api/items/[id]/move/route.ts              # POST: triage move
  /api/items/[id]/reject/route.ts            # POST: triage reject
  /api/items/[id]/create-folder/route.ts     # POST: triage create+file (supports nested paths via ensureFolderPath)
  /api/taxonomy/route.ts                     # GET: folders + sampleFilenames (ETag-cached)
  /api/ask/route.ts                          # POST: question embed → pgvector top-k → Haiku synthesize → citations
/lib
  prisma.ts                                  # Neon HTTP adapter
  trace.ts                                   # noop wrapper; swap LangSmith later
  taxonomy.ts                                # getFolderTree + getSampleFilenames + computeFolderPath
  folder-path.ts                             # ensureFolderPath (walks + creates ancestors)
  final-filename.ts                          # FinalFilenameSchema (extension strip + allowlist)
  transition-item.ts                         # shared mutation helper
  require-auth.ts                            # Clerk user vs machine identity helper
/prisma
  schema.prisma
  seed.ts                                    # reads taxonomy-v5.json → Folder rows
  seeds/taxonomy-v5.json                     # 6-folder cold seed
/components
  /triage                                    # TriageView, FolderCombobox, SourceBadge
  /ask                                       # AskView
/__tests__                                   # Jest + docker-compose.local.yml for integration
```

## Skill routing

When the user's request matches a skill, invoke it via the Skill tool. When in doubt, invoke the skill.

- Product ideas / brainstorming → `/office-hours`
- Strategy / scope / rethink the wedge → `/plan-ceo-review`
- Architecture / data flow / engineering review → `/plan-eng-review`
- Design system / plan-mode design review → `/design-consultation` or `/plan-design-review`
- Full review pipeline → `/autoplan`
- Bugs / errors / "why is this broken" → `/investigate`
- QA / test the site / verify a deploy → `/qa` or `/qa-only`
- Code review / diff check → `/review`
- Visual polish on a live site → `/design-review`
- Ship / deploy / PR → `/ship` or `/land-and-deploy`
- Save / resume working context → `/context-save` / `/context-restore`

## Performance Patterns (must not regress)

Recent prod incidents (commits `de7822e`, `10657c5`, `9ea82bf`, `69be824`) established two non-obvious patterns:

1. **`prisma.$queryRaw` over the Neon HTTP transport for hot paths.** Don't reach for `prisma.findMany` + Prisma ORM on routes that handle vector queries, the worker claim, or the sweep. The HTTP transport rewards single-statement SQL.
2. **Async cleanup is fire-and-forget.** Awaiting cleanup work in route handlers (e.g. trace flushes, log sinks) added a 9.5s tax in production. Trace and log cleanup must be called WITHOUT `await` at the end of the handler.

## Operational notes

- **Local Postgres for tests:** `docker-compose.local.yml` provides a real Postgres for integration tests. Use it for `__tests__/api/*` and `__tests__/lib/*`.
- **Project memory ("CORTEX_OWNER_USER_ID gotcha"):** the v0 bug where the agent wrote `Item.user_id` from env and the triage UI filtered by Clerk userId. In v1 this is structurally impossible — the agent doesn't have direct DB access; `userId` on `Item` is set server-side from the Clerk Machine Token identity. Memory note can retire after v1 ships.
- **Anthropic API key after 2026-06-15:** the old project memory about "never pass ANTHROPIC_API_KEY to claude -p" becomes obsolete after that date when the Claude CLI subscription billing ends. The new v1 worker uses the SDK directly and SETS `ANTHROPIC_API_KEY` intentionally.
