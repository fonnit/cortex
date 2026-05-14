# Cortex

A personal AI-native information system that captures everything Daniel receives across Downloads and (later) Gmail, learns his filing system from how he reacts to items, and answers anything in plain English from any device. Single-operator tool, not a product — internal-first with tenancy-ready schema.

**Core value:** the triage feedback loop compounds fast enough that weekly triage load trends down, not flat or up — Cortex learns to file so Daniel doesn't have to.

## v1 scope (current)

Manual `cortex add <file>` → server-side classify (Claude Haiku 4.6 via Anthropic SDK) → human approves in triage UI → file moved into `~/Documents/CortexArchive/<folder>/` (iCloud-synced).

**Out of v1:** Gmail ingest, Drive blob store, embeddings, Q&A, OCR, chokidar watcher, MCP server, model-driven folder-proposal UI, ItemFact / structured extraction, Langfuse / observability.

The running spec lives in the plan file at `~/.claude/plans/compressed-wobbling-treehouse.md` and the design doc at `~/.gstack/projects/fonnit-cortex/dfonnegrag-main-design-20260512-233606.md`. Read those before changing core architecture.

## Constraints

- **Storage:** Neon Postgres only — no SQLite, no in-memory stores.
- **Migrations:** Prisma 7 through Vercel build, never locally. v1 wipes existing data (no backfill).
- **Auth:** Clerk with MFA for browser routes; Clerk Machine Tokens (M2M, client-credentials grant) for the worker.
- **Worker boundary:** the Mac worker uses the HTTP API only. It does NOT have `DATABASE_URL`. All DB access goes through backend routes.
- **Move target:** `~/Documents/CortexArchive/<folder.path>/<basename>`. iCloud-synced via the macOS "Desktop & Documents Folders" toggle; backup is automatic.
- **Classification:** Claude Haiku 4.6 via `@anthropic-ai/sdk` directly. Multimodal content blocks for image and native-PDF input. After 2026-06-15 Claude CLI subscription billing ends; Max subscribers get $100/mo API credits which covers Cortex spend (~$5-50/year) many times over.
- **Embeddings (v2):** OpenAI text-embedding-3-small, 512 dims, halfvec in pgvector. v2 migration creates the `ItemChunk` table AND enables the pgvector extension in the same migration.
- **Observability:** `lib/trace.ts` is a noop wrapper in v1. LangSmith plug if observability surfaces a need (TODO in `TODOS.md`).

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

- **Prisma over Neon HTTP transport, not WebSocket.** Use `prisma.$queryRaw` for hot paths (vector queries, claim route, sweep). Multi-statement `$transaction` blocks over HTTP are problematic; keep transactions single-statement where possible. See commits `9ea82bf`, `67f2206`, `de7822e` for the pattern.
- **No Langfuse fire-and-forget pitfalls** — Langfuse is dropped from v1. `lib/trace.ts` is a noop wrapper for future provider swap. Don't reintroduce Langfuse without explicit decision.
- **Worker token via Clerk Machine Token, not bespoke bearer.** Worker calls `POST /oauth/token` with `client_credentials`, caches the access_token until expiry, sends `Authorization: Bearer <token>` on every API call. Server uses `auth()` from `@clerk/nextjs/server`.
- **All worker DB access goes through API routes.** No DATABASE_URL on the worker. Worker reads taxonomy via `GET /api/taxonomy` (ETag-cached), claims items via `POST /api/items/claim` (server-side SELECT FOR UPDATE SKIP LOCKED + UPDATE returning), posts classification via `POST /api/items/[id]/classification`, posts file-move completion via `POST /api/items/[id]/moved`.
- **Status transitions through `lib/transition-item.ts`.** The four human mutation routes (approve, move, reject, create-folder) share one helper that runs `$transaction → check allowed-from-state → write Decision row → update Item`. Don't duplicate this logic in route handlers.

## File layout

```
/agent                                       # Mac worker process
  worker.ts                                  # two stateless poll loops (classify + move)
  cortex-add.ts                              # CLI
  classify.ts                                # Anthropic SDK + Haiku, Zod-validated
  clerk-m2m.ts                               # client-credentials token caching
  text-extract.ts                            # dispatcher by extension
/app
  /triage/page.tsx                           # triage UI (rewired)
  /api/items/route.ts                        # POST: enqueue from CLI
  /api/items/claim/route.ts                  # POST: worker claim (SELECT FOR UPDATE SKIP LOCKED)
  /api/items/[id]/classification/route.ts    # POST: worker posts classification
  /api/items/[id]/moved/route.ts             # POST: worker reports file moved
  /api/items/[id]/approve/route.ts           # POST: triage approve (Clerk)
  /api/items/[id]/move/route.ts              # POST: triage move (Clerk)
  /api/items/[id]/reject/route.ts            # POST: triage reject (Clerk)
  /api/items/[id]/create-folder/route.ts     # POST: triage create+file (Clerk)
  /api/taxonomy/route.ts                     # GET: folder tree (ETag-cached)
/lib
  prisma.ts                                  # existing, do not regress
  trace.ts                                   # v1 noop; swap LangSmith later
  taxonomy.ts                                # seed loader + Folder.path maintenance
  transition-item.ts                         # shared mutation helper
  require-auth.ts                            # Clerk user vs machine identity helper
/prisma
  schema.prisma
  seed.ts                                    # taxonomy v4 → Folder rows
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
