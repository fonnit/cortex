import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Cortex v1 auth boundary.
//
// Every /api/* route passes through Clerk. There are two identity kinds:
//   - User session (browser) — has clerkId; resolves to User row.
//   - Machine Token (Mac worker) — has machineId; resolves to a User row by
//     convention (single owner). See lib/require-auth.ts.
//
// Worker routes accept Clerk Machine Tokens (Bearer header with the `ak_...`
// secret directly — no /oauth/token exchange). The middleware lets these
// through; per-route handlers further restrict via requireAuth(['user'|'machine']).
//
// Public routes (no auth) below are sign-in only.

const isPublicRoute = createRouteMatcher(['/sign-in(.*)'])

const isWorkerRoute = createRouteMatcher([
  '/api/items',
  '/api/items/claim',
  '/api/items/(.*)/classification',
  '/api/items/(.*)/moved',
  '/api/items/(.*)/move-failed',
  '/api/items/(.*)/source-missing',
  '/api/items/(.*)/unsupported',
  '/api/taxonomy',  // worker reads taxonomy too; also used by browser
])

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return
  if (isWorkerRoute(request)) {
    // Worker routes accept Clerk API Keys (the `ak_` prefix token Daniel got
    // from the dashboard) in addition to user sessions. The per-route handler
    // further restricts via requireAuth(['user'|'machine']).
    await auth.protect({ token: ['session_token', 'api_key'] })
    return
  }
  await auth.protect()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
