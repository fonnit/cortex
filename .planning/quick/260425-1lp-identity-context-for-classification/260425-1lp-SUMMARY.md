---
phase: quick-260425-1lp
plan: 01
subsystem: database, api, ui, pipeline
tags: [prisma, neon, clerk, identity, classification, react-query, tailwind]

requires: []
provides:
  - IdentityProfile Prisma model with owner + known_person roles
  - fetchIdentityContext utility that reads from Neon and formats a prompt block
  - Identity context injected into relevance and label classification prompts
  - Two 'from' axis rules in label classifier for person-name preference and uncertainty routing
  - CRUD REST API at /api/identity scoped to Clerk userId
  - Settings page at /settings with IdentityForm client component
affects: [pipeline, classification, triage, taxonomy]

tech-stack:
  added: []
  patterns:
    - "Identity fetch internal to classifier functions — call signatures unchanged at call sites"
    - "Prisma queries scoped by user_id derived from Clerk auth() — never trust client-supplied user_id"

key-files:
  created:
    - prisma/schema.prisma (IdentityProfile model added)
    - agent/src/pipeline/identity.ts
    - app/api/identity/route.ts
    - app/(app)/settings/page.tsx
    - app/(app)/settings/IdentityForm.tsx
  modified:
    - agent/src/pipeline/relevance.ts
    - agent/src/pipeline/label.ts
    - components/shell/Sidebar.tsx

key-decisions:
  - "Identity fetch is internal to classifier functions — preserves existing call signatures in agent/src/index.ts"
  - "Prisma client used in API route (not raw sql) for type safety; raw neon sql used in agent (no server-side Prisma)"
  - "Prisma generate run to include IdentityProfile before TypeScript compilation"

requirements-completed: []

duration: 20min
completed: 2026-04-24
---

# Quick Task 260425-1lp: Identity Context for Classification Summary

**IdentityProfile Neon model + fetchIdentityContext utility with prompt injection into both relevance and label classifiers, plus CRUD API and settings UI for managing owner and known-person profiles.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-24T00:00:00Z
- **Completed:** 2026-04-24T00:20:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- IdentityProfile schema added to Prisma (role, name, email, company, relationship) with unique constraint on user_id+name and index on user_id+role
- fetchIdentityContext reads owner and known-person rows from Neon, formats a contextBlock string injected into both relevance and label prompts
- Label classifier gains two explicit 'from' axis rules: prefer known-person names over institutions, route to triage when ownership is ambiguous
- CRUD API at /api/identity with Clerk auth guard and user_id-scoped Prisma queries (T-1lp-01 and T-1lp-02 mitigated)
- Settings page at /settings with React Query-backed IdentityForm for add/delete of profiles; Settings nav item added to Sidebar

## Task Commits

1. **Task 1: IdentityProfile schema + CRUD API** - `79cd91f` (feat)
2. **Task 2: Identity fetch utility + prompt injection** - `ba40aff` (feat)
3. **Task 3: Settings page for identity management** - `efe846a` (feat)

## Files Created/Modified

- `prisma/schema.prisma` — IdentityProfile model appended after RuleConsolidationProposal
- `agent/src/pipeline/identity.ts` — fetchIdentityContext + IdentityContext interface; reads Neon via raw sql
- `agent/src/pipeline/relevance.ts` — identityContext injected into buildRelevancePrompt and buildGmailRelevancePrompt; fetch inside classifyRelevance and classifyGmailRelevance
- `agent/src/pipeline/label.ts` — identityContext injected into buildLabelPrompt with two new 'from' axis rules; fetch inside classifyLabel
- `app/api/identity/route.ts` — GET, POST, PUT, DELETE with Clerk auth and user_id-scoped Prisma
- `app/(app)/settings/page.tsx` — server component, title + subtitle + IdentityForm
- `app/(app)/settings/IdentityForm.tsx` — client component, React Query list + add form + delete
- `components/shell/Sidebar.tsx` — Settings nav item added (kbd S)

## Decisions Made

- Identity fetch is internal to each classifier so agent/src/index.ts call sites require no changes.
- Raw neon sql used in identity.ts (agent package has no Prisma setup); Prisma client used in the API route for full type safety.
- `npx prisma generate` run to regenerate client after schema change — required for TypeScript to resolve `prisma.identityProfile`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Ran prisma generate to resolve IdentityProfile TypeScript types**
- **Found during:** Task 3 (TypeScript check)
- **Issue:** `prisma.identityProfile` not found on PrismaClient — client not regenerated after schema change
- **Fix:** Ran `npx prisma generate` to include new model; errors cleared
- **Files modified:** node_modules/@prisma/client (not tracked)
- **Verification:** `tsc --noEmit` (excluding pre-existing test file errors) passes clean
- **Committed in:** part of Task 3 flow (node_modules not committed)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required step to unblock TypeScript compilation. No scope creep.

## Issues Encountered

- Pre-existing TypeScript errors in `__tests__/triage-api.test.ts` (missing `@types/jest`) were present before this work and are out of scope. All new files compile cleanly.

## Threat Surface

| Flag | File | Description |
|------|------|-------------|
| mitigated: T-1lp-01 | app/api/identity/route.ts | Clerk auth() check at every handler; 401 on missing userId |
| mitigated: T-1lp-02 | app/api/identity/route.ts | Prisma queries use `where: { id, user_id: userId }` — client cannot tamper across users |

## Next Steps

- Run `npx prisma migrate dev --name add-identity-profile` to create the migration and push to Neon
- Seed an owner profile for Daniel to activate identity context in classifier prompts
- Verify via Langfuse trace that label prompt includes owner name after seeding
