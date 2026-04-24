---
phase: 02-triage-web-app
plan: 01
subsystem: auth
tags: [clerk, nextjs, prisma, neon, css-custom-properties, next-font]

requires: []

provides:
  - clerkMiddleware protecting all non-public routes in middleware.ts
  - requireAuth() helper for Route Handlers in lib/auth.ts
  - Sign-in page at /sign-in via Clerk SignIn component
  - Full design system CSS custom properties in app/globals.css (verbatim from design/project/styles.css)
  - Root layout with ClerkProvider, font preloading, and ThemeScript dark mode
  - Prisma singleton with PrismaNeonHttp adapter in lib/prisma.ts

affects:
  - 02-02 (app shell + triage UI — depends on auth middleware and globals.css)
  - 02-03 (triage queue Route Handlers — depends on requireAuth and prisma)
  - 02-04 (Drive resolve cron — depends on prisma)
  - 02-05 (observability — depends on root layout)

tech-stack:
  added: []
  patterns:
    - "clerkMiddleware with createRouteMatcher for public route exceptions"
    - "PrismaNeonHttp singleton via globalThis for Vercel Function hot-reload safety"
    - "ThemeScript inline script for flash-free dark mode from localStorage"
    - "next/font/google with CSS variable injection alongside globals.css font stacks"

key-files:
  created:
    - middleware.ts
    - lib/auth.ts
    - lib/prisma.ts
    - app/globals.css
    - app/layout.tsx
    - app/sign-in/[[...sign-in]]/page.tsx
  modified: []

key-decisions:
  - "PrismaNeonHttp over PrismaNeon: takes connection string directly, simpler for serverless Functions than Pool-based adapter"
  - "ThemeScript injected in <head> (not body) to fire before paint and avoid dark mode flash"
  - "globals.css is a verbatim copy of design/project/styles.css with a DO NOT EDIT header — single source of truth enforced via comment"

patterns-established:
  - "Route Handler auth pattern: import requireAuth from lib/auth.ts, await at top of handler, throws 401 Response on missing session"
  - "Dark mode: data-theme attribute set by ThemeScript on document root, CSS selects [data-theme='dark']"

requirements-completed:
  - AUTH-01
  - AUTH-02
  - DSN-01
  - DSN-02
  - DSN-05

duration: 18min
completed: 2026-04-24
---

# Phase 2 Plan 01: Auth Bootstrap + Design System Summary

**Clerk middleware protecting all routes, full design system globals verbatim from styles.css, ClerkProvider root layout with Newsreader/Inter Tight/JetBrains Mono, and PrismaNeonHttp singleton**

## Performance

- **Duration:** 18 min
- **Started:** 2026-04-24T20:00:00Z
- **Completed:** 2026-04-24T20:18:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- clerkMiddleware gates all routes except /sign-in(.*); zero unauthenticated access to app routes
- app/globals.css is a byte-faithful copy of the design handoff — every custom property, dark mode selector, and component rule preserved
- Root layout loads all three fonts via next/font (preloading + display:swap) and wraps app in ClerkProvider with flash-free dark mode via ThemeScript
- lib/prisma.ts exports a Vercel-safe Prisma singleton using PrismaNeonHttp over the serverless Neon transport

## Task Commits

1. **Task 1: Clerk middleware + auth infrastructure** - `bae54c3` (feat)
2. **Task 2: Global CSS design system + root layout + Prisma client** - `4a29ede` (feat)

## Files Created/Modified

- `middleware.ts` — clerkMiddleware with createRouteMatcher, full static-file exclusion config
- `lib/auth.ts` — requireAuth() for Route Handlers; re-exports auth for Server Components; Clerk modal keyboard note
- `app/sign-in/[[...sign-in]]/page.tsx` — SignIn component centered on --cx-bg
- `app/globals.css` — verbatim copy of design/project/styles.css (862 lines, all custom properties + component rules)
- `app/layout.tsx` — ClerkProvider, Newsreader/Inter Tight/JetBrains Mono via next/font, ThemeScript, metadata
- `lib/prisma.ts` — PrismaNeonHttp singleton with globalThis cache for dev hot-reload safety

## Decisions Made

- **PrismaNeonHttp over PrismaNeon**: The plan's code example used PrismaNeon with neon() which is the v5/v6 pattern. In Prisma 7, PrismaNeonHttp takes a connection string directly — cleaner for Vercel Functions with no Pool lifecycle to manage.
- **ThemeScript in `<head>`**: Placed before body render to fire before paint; avoids any flash of unstyled/wrong-theme content.
- **next/font CSS variables alongside globals.css font stacks**: globals.css defines --cx-ff-serif etc. with the actual font names; next/font injects --font-newsreader etc. on `<html>` for preloading. Both coexist without conflict.

## Deviations from Plan

**1. [Rule 1 - Bug] PrismaNeon → PrismaNeonHttp**
- **Found during:** Task 2 (lib/prisma.ts)
- **Issue:** Plan's code example used Prisma 5/6 API: `new PrismaClient({ adapter: new PrismaNeon(neon(DATABASE_URL)) })`. In Prisma 7, PrismaNeon takes a PoolConfig, not a neon() result. PrismaNeonHttp is the correct serverless-HTTP adapter taking a connection string.
- **Fix:** Used PrismaNeonHttp with the connection string directly; removed the neon() call.
- **Files modified:** lib/prisma.ts
- **Committed in:** 4a29ede (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — API version mismatch)
**Impact on plan:** Fix required for correctness; no scope change.

## Issues Encountered

None — TypeScript check passed with zero errors on all new files.

## Known Stubs

None — this plan creates infrastructure only; no UI data rendering.

## User Setup Required

Clerk environment variables must be configured before the app can start:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — from Clerk dashboard
- `CLERK_SECRET_KEY` — from Clerk dashboard

Both are already documented in `.env.example`.

## Next Phase Readiness

- Auth middleware in place — all Phase 2 Route Handlers can use `requireAuth()`
- Design system globals loaded — all component styles are available
- Prisma singleton ready — all Route Handlers import `{ prisma }` from `lib/prisma.ts`
- Next: Plan 02-02 — app shell (sidebar, topbar, metrics strip) and triage route group

## Self-Check: PASSED

- `middleware.ts` exists and contains `clerkMiddleware` and `auth.protect`
- `lib/auth.ts` exists and exports `requireAuth`
- `lib/prisma.ts` exists and contains `PrismaNeonHttp`
- `app/globals.css` exists and contains `--cx-bg: #f6f2ea`
- `app/layout.tsx` exists and contains `ClerkProvider` and `Newsreader`
- `app/sign-in/[[...sign-in]]/page.tsx` exists and contains `SignIn`
- Task 1 commit `bae54c3` present
- Task 2 commit `4a29ede` present

---
*Phase: 02-triage-web-app*
*Completed: 2026-04-24*
