# Technology Stack

**Project:** Cortex
**Researched:** 2026-04-24
**Overall confidence:** HIGH (all versions verified via npm registry; architecture confirmed against official docs)

---

## Recommended Stack

### Web App (Vercel / Next.js)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| next | 16.2.4 | Web framework | Current stable. Turbopack stable, React Compiler stable. App Router is the right target — RSC + Server Actions remove most client-state complexity for a triage UI. |
| react | 19.2.5 | UI runtime | Ships with Next 16. React Compiler eliminates manual memo/callback overhead. |
| typescript | 6.0.3 | Type safety | Required. Prisma generates typed client; Zod schema narrowing depends on it. |
| tailwindcss | 4.2.4 | Styling | v4 drops the config file; uses CSS-first theming. Correct for the warm ivory/ink design system. |
| @tanstack/react-query | 5.100.1 | Server-state cache | Triage queue needs optimistic updates and background refetch. React Query v5 has first-class RSC support. |
| zod | 4.3.6 | Runtime validation | Schema validation for API routes, rule predicates, taxonomy ops. Pairs with React Hook Form. |

### Auth

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @clerk/nextjs | 7.2.5 | Auth + MFA | Constraint from PROJECT.md. Clerk 7 is fully App Router native. Google OAuth scopes for Drive/Gmail are NOT handled by Clerk — Clerk handles user identity only. Mac agent handles Google OAuth separately via service-account or user-delegated credentials stored in the agent keychain. |

### Database

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| prisma | 7.8.0 | ORM + migrations | Constraint from PROJECT.md: "migrations through Vercel build, never locally." Prisma 7 is the current stable with edge-runtime support via the Neon adapter — the binary issue that made Drizzle preferable in serverless is resolved. |
| @prisma/adapter-neon | 7.8.0 | Neon HTTP driver | Enables Prisma over Neon's serverless HTTP transport instead of TCP. Required for Vercel Functions. |
| @neondatabase/serverless | 1.1.0 | Neon driver | Underlying transport for the Prisma adapter. Also used directly for raw SQL on vector queries where Prisma's pgvector support is insufficient. |

**pgvector configuration:** `halfvec(512)` for all embedding columns. halfvec uses 16-bit floats → 50% storage reduction vs `vector`. text-embedding-3-small supports dimension reduction to 512 via the `dimensions` API parameter — this is a first-class OpenAI feature, not truncation. Index type: `hnsw` (not ivfflat) — HNSW gives better recall at query time and does not require knowing row count at index creation.

### Observability

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| langfuse | 3.38.20 | LLM tracing | Constraint from PROJECT.md. The `langfuse` npm package is the JS/TS SDK. v3 is current stable cloud-compatible version (v4/v5 target self-hosted Langfuse platform ≥ 3.95.0 — cloud users stay on v3 unless Langfuse cloud has upgraded). Wrap every classify/chunk/embed/ask call with a Langfuse span. |

**Note:** Langfuse JS SDK is in active major version flux (v3 → v4 → v5 within 2025-2026). Pin to `3.38.20` and upgrade only after verifying Langfuse cloud platform version compatibility.

### Mac Agent (launchd daemon)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 22 LTS | Runtime | chokidar v5 requires Node ≥ 20. Node 22 is current LTS. The daemon runs as a persistent process under launchd with `KeepAlive = true`. |
| chokidar | 5.0.0 | File watching | v5 is ESM-only, uses native FSEvents on macOS via the darwin kernel API. Zero polling. Correct for Downloads directory watching. v4 is the CJS fallback if ESM is problematic in the launchd context. |
| googleapis | 171.4.0 | Gmail + Drive API | Official Google client. Uses `users.history.list` with stored `historyId` for incremental Gmail sync. Drive v3 for uploads. OAuth2 credentials stored in macOS Keychain via `keytar` or as a local JSON file under `~/.config/cortex/`. |
| @anthropic-ai/sdk | 0.91.0 | Claude classification | Direct API calls from the agent process. Two-stage pipeline: relevance gate (Claude Haiku, low cost) → label classifier (Claude Haiku or Sonnet depending on confidence threshold). |
| openai | 6.34.0 | Embeddings | text-embedding-3-small with `dimensions: 512`. Called after classification confirms an item is relevant. |

**launchd plist pattern:** `KeepAlive = true` + `RunAtLoad = true`. The daemon polls Gmail on a configurable interval (start: 5 min) and reacts to fsevents immediately. A separate `StartInterval` plist key handles the Gmail poll without a cron dependency.

### API Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Next.js Route Handlers | — | REST endpoints | App Router Route Handlers are the right surface for triage actions, taxonomy ops, and the MCP search tool endpoint. No separate Express/Fastify server. |
| Vercel AI SDK | — | Streaming Q&A | If streaming is needed for the Claude Haiku retrieval synthesis surface. Optional — evaluate at implementation. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| ORM | Prisma 7 | Drizzle 0.45 | PROJECT.md constrains migrations to Prisma through Vercel build. Drizzle is otherwise competitive but would contradict the stated constraint. |
| File watcher | chokidar 5 | raw fsevents npm | chokidar adds debounce, glob filtering, and error recovery that the raw fsevents binding does not provide. |
| Vector index | hnsw | ivfflat | ivfflat requires `VACUUM` after bulk inserts and needs row count at index creation. HNSW builds incrementally and is the correct choice for a growing personal archive. |
| Embedding dims | halfvec(512) | vector(1536) | 50% storage + 50% index size. OpenAI explicitly supports 512-dim output from text-embedding-3-small. No recall regression at this scale. |
| Auth Google scopes | Mac agent OAuth | Clerk Google OAuth | Clerk's Google OAuth only grants identity scopes (email, profile). Drive and Gmail API scopes require a separate OAuth2 flow that stores tokens outside Clerk. |
| Observability | Langfuse | LangSmith / Helicone | PROJECT.md constraint. Langfuse is also open-source and self-hostable if needed. |

---

## Installation

```bash
# Web app
npm install next@16.2.4 react@19.2.5 react-dom@19.2.5 typescript@6.0.3
npm install tailwindcss@4.2.4 @tailwindcss/typography
npm install @tanstack/react-query@5.100.1 zod@4.3.6
npm install @clerk/nextjs@7.2.5
npm install prisma@7.8.0 @prisma/adapter-neon@7.8.0 @neondatabase/serverless@1.1.0
npm install langfuse@3.38.20
npm install openai@6.34.0

# Mac agent
npm install chokidar@5.0.0 googleapis@171.4.0 @anthropic-ai/sdk@0.91.0 openai@6.34.0
```

---

## Critical Constraints (from PROJECT.md)

1. **No SQLite, no in-memory stores.** Neon Postgres only. Even the Mac agent writes directly to Neon via the serverless driver over HTTPS.
2. **Migrations through Vercel build.** `prisma migrate deploy` runs in the Vercel build step. Never `prisma migrate dev` against production.
3. **Embeddings:** `text-embedding-3-small`, 512 dims, `halfvec` column type in pgvector. Do not use `vector(1536)`.
4. **Mac agent uses Claude CLI / SDK, not the web app.** Classification happens in the daemon process; the web app only reads results from Neon.

---

## Open Questions

- **Langfuse cloud platform version:** Verify whether Langfuse cloud has reached platform ≥ 3.95.0 before upgrading SDK to v4. If not, stay on `langfuse@3.x`.
- **Mac agent ESM:** chokidar v5 is ESM-only. Confirm the agent package is set to `"type": "module"` or use chokidar v4 (`^4.0.1`) if CJS is required by any dependency.
- **Google OAuth token storage on Mac:** `keytar` (native Keychain) vs encrypted JSON file. Decision has security implications — needs explicit choice before Mac agent implementation phase.
- **Vercel AI SDK:** Evaluate at Q&A implementation phase. Only add if streaming UX is needed for the Claude Haiku retrieval synthesis response.

---

## Sources

- Next.js 16 release: https://nextjs.org/blog/next-16
- Next.js 16.1: https://nextjs.org/blog/next-16-1
- Neon halfvec guide: https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost
- Neon pgvector docs: https://neon.com/docs/extensions/pgvector
- Prisma 6 release: https://www.prisma.io/blog/prisma-6-better-performance-more-flexibility-and-type-safe-sql
- Prisma + Neon docs: https://neon.com/docs/guides/prisma
- Langfuse JS SDK: https://github.com/langfuse/langfuse-js
- Langfuse v3→v4 upgrade: https://langfuse.com/docs/observability/sdk/upgrade-path/js-v3-to-v4
- chokidar v5: https://github.com/paulmillr/chokidar
- Gmail incremental sync: https://developers.google.com/workspace/gmail/api/guides/sync
- OpenAI embeddings dimensions: https://developers.openai.com/api/docs/guides/embeddings
- Clerk Next.js: https://clerk.com/docs/nextjs/reference/components/authentication/sign-in
- All versions: npm registry (verified 2026-04-24)
