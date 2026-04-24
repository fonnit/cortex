---
phase: 01-foundation
plan: 01
subsystem: database
tags: [prisma, neon, postgres, pgvector, halfvec, node, esm, typescript]

# Dependency graph
requires: []
provides:
  - Complete Prisma schema with Item, GmailCursor, TaxonomyLabel, MetricSnapshot models
  - All irreversible columns (classification_trace JSONB, near_duplicate_of FK, halfvec(512), user_id tenancy)
  - Web app package.json with Prisma 7.8.0 and full Next.js 16 stack
  - agent/package.json as ESM package with chokidar 5, googleapis, keytar, langfuse
  - .env.example documenting all secrets through Phase 4
  - prisma.config.ts for Prisma 7 datasource configuration
  - .gitignore protecting credentials and generated files
affects: [02-02, 02-03, 02-04, 02-05, 02-06]

# Tech tracking
tech-stack:
  added:
    - prisma@7.8.0
    - "@prisma/adapter-neon@7.8.0"
    - "@neondatabase/serverless@1.1.0"
    - next@16.2.4
    - react@19.2.5
    - typescript@6.0.3
    - tailwindcss@4.2.4
    - "@tanstack/react-query@5.100.1"
    - zod@4.3.6
    - "@clerk/nextjs@7.2.5"
    - langfuse@3.38.20
    - openai@6.34.0
    - chokidar@5.0.0
    - googleapis@171.4.0
    - "@anthropic-ai/sdk@0.91.0"
    - keytar@7.9.0
  patterns:
    - Prisma 7 datasource URL in prisma.config.ts (breaking change from v6)
    - agent/ as separate ESM package required by chokidar v5
    - halfvec(512) embedding column present from day one for schema stability

key-files:
  created:
    - prisma/schema.prisma
    - prisma.config.ts
    - package.json
    - package-lock.json
    - agent/package.json
    - agent/tsconfig.json
    - .env.example
    - .gitignore
  modified: []

key-decisions:
  - "Prisma 7.8.0 breaking change: datasource url lives in prisma.config.ts, not schema.prisma — prisma.config.ts conditionally sets url only when DATABASE_URL is present so validate/generate commands work without credentials"
  - "agent/ is a separate ESM package (type: module) required by chokidar v5 which is ESM-only"
  - "halfvec(512) embedding column added in Phase 1 schema even though not populated until Phase 4 — avoids retroactive migration after data exists"
  - "MetricSnapshot model added for OBS-06: uncertain_rate and auto_filed_rate tracked daily from day one"

patterns-established:
  - "Pattern: schema.prisma has no datasource url — all connection config lives in prisma.config.ts"
  - "Pattern: agent/ as isolated ESM package with its own package.json and tsconfig.json"
  - "Pattern: .env.example is the only committed credential file; .gitignore protects .env"

requirements-completed:
  - ING-03
  - ING-04
  - CLS-03
  - CLS-04
  - CLS-06
  - CLS-07
  - CLS-08
  - DRV-01
  - OBS-06

# Metrics
duration: 35min
completed: 2026-04-24
---

# Phase 01 Plan 01: Neon Schema and Project Package Structure Summary

**Complete Prisma 7 schema with 4 models (all irreversible columns), web app and agent package structure, and Prisma 7 datasource config pattern**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-04-24T19:00:00Z
- **Completed:** 2026-04-24T19:35:00Z
- **Tasks:** 2
- **Files modified:** 8 created, 0 modified (net new project)

## Accomplishments
- Prisma schema with all 4 models: Item (with classification_trace JSONB, near_duplicate_of self-FK, halfvec(512), user_id tenancy), GmailCursor, TaxonomyLabel, MetricSnapshot
- Web app package.json with complete Next.js 16 + Prisma 7.8.0 stack; installed via npm
- agent/package.json as ESM package (type: module) with chokidar 5, googleapis, keytar, langfuse; installed clean
- prisma.config.ts implementing Prisma 7 datasource config pattern (url moved out of schema.prisma)
- .env.example documenting all 6 env var groups through Phase 4
- .gitignore protecting node_modules, .env files, build artifacts

## Task Commits

1. **Task 1: Write prisma/schema.prisma with all Phase 1-4 columns** - `8025537` (feat)
2. **Task 2: Initialize agent ESM package + prisma.config.ts + .env.example** - `9a69da3` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - 4 models with all irreversible columns
- `prisma.config.ts` - Prisma 7 datasource config with conditional DATABASE_URL
- `package.json` - Web app dependencies (Next.js 16, Prisma 7.8.0, full stack)
- `package-lock.json` - Locked web app dependency tree
- `agent/package.json` - ESM daemon package with chokidar 5, googleapis, keytar
- `agent/tsconfig.json` - TypeScript config targeting ES2022/ESNext
- `.env.example` - All required env vars documented (Neon, Anthropic, Langfuse, Google, Clerk)
- `.gitignore` - Protects node_modules, .env, dist, .next

## Decisions Made
- Prisma 7.8.0 breaks the `url` field in `datasource db {}` block — moved to `prisma.config.ts` per the v7 migration guide. Config conditionally omits datasource when DATABASE_URL is absent so `prisma validate` and `prisma generate` work without credentials.
- agent/ package must be `"type": "module"` — chokidar v5 is ESM-only; verified from package research.
- Added .gitignore as missing critical security control (Rule 2) — without it, node_modules and .env could be committed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prisma 7.8.0 datasource url breaking change**
- **Found during:** Task 2 (prisma validate)
- **Issue:** Prisma 7.8.0 no longer accepts `url = env("DATABASE_URL")` in schema.prisma datasource block; throws P1012 validation error
- **Fix:** Removed `url` from datasource block in schema.prisma; created prisma.config.ts using `defineConfig()` with conditional datasource url (uses `process.env.DATABASE_URL` directly, not the `env()` helper that throws when unset, so validate/generate work without credentials)
- **Files modified:** prisma/schema.prisma, prisma.config.ts (new)
- **Verification:** `prisma validate` exits 0 without DATABASE_URL; exits 0 with DATABASE_URL
- **Committed in:** 9a69da3 (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added .gitignore**
- **Found during:** Task 2 (git status check)
- **Issue:** No .gitignore existed; node_modules/ (2000+ files) was untracked and at risk of accidental commit; .env would not be protected
- **Fix:** Created .gitignore covering node_modules, .env files, .next, dist, agent/dist
- **Files modified:** .gitignore (new)
- **Verification:** git status no longer shows node_modules as untracked
- **Committed in:** 9a69da3 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug — Prisma v7 breaking change; 1 missing critical — gitignore)
**Impact on plan:** Both fixes necessary for schema validity and credential security. No scope creep.

## Issues Encountered
- `prisma db push` not run — DATABASE_URL not available in the execution environment. All file artifacts are complete and committed. Push must be run manually once DATABASE_URL is set (see User Setup Required below).

## User Setup Required

To complete Task 2's blocking step, run after setting DATABASE_URL:

```bash
# 1. Create .env in the cortex project root:
cp /Users/dfonnegrag/Projects/cortex/.env.example /Users/dfonnegrag/Projects/cortex/.env
# Edit .env — fill in DATABASE_URL from Neon dashboard (Connection string, pooled, ?sslmode=require)

# 2. Push schema to Neon:
cd /Users/dfonnegrag/Projects/cortex
npx prisma db push

# 3. Verify:
npx prisma validate
```

Required services:
- **Neon**: Postgres database — get DATABASE_URL from Neon dashboard → Project → Connection string (pooled, ?sslmode=require)
- **Langfuse**: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY from Langfuse dashboard → Settings → API Keys
- **Anthropic**: ANTHROPIC_API_KEY from console.anthropic.com → API Keys
- **Google**: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client
- **Clerk**: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY from Clerk dashboard (Phase 2)

## Known Stubs

None — this plan is schema/package structure only, no UI or data rendering.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced beyond what the threat model covers. T-01-01 (credentials in .env) mitigated by .gitignore and .env.example pattern. T-01-03 (DATABASE_URL SSL) documented in .env.example template with `?sslmode=require`.

## Next Phase Readiness
- Schema is complete and valid — all subsequent plans can reference the models
- agent/ package installs cleanly — Phase 1 plans building daemon logic can proceed
- DATABASE_URL must be set and `prisma db push` run before any Neon-dependent plans can execute
- All env var names are documented in .env.example for easy setup

---
*Phase: 01-foundation*
*Completed: 2026-04-24*
