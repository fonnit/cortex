import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Cortex v1 auth boundary.
//
// Two identity kinds:
//   - User session (browser) — clerkMiddleware's auth.protect() handles this.
//   - Machine (Mac worker) — sends Authorization: Bearer mt_... (Clerk M2M
//     token). The route handler verifies via lib/require-auth.ts using the
//     backend's CLERK_MACHINE_SECRET_KEY.
//
// Worker routes are NOT auth.protect()'d here, because Clerk's default
// middleware only accepts user sessions. Per-route requireAuth(['machine'])
// enforces the worker identity. The /triage UI routes are session-protected
// as normal.

const isPublicRoute = createRouteMatcher(['/sign-in(.*)'])

const isWorkerRoute = createRouteMatcher([
  '/api/items',
  '/api/items/claim',
  '/api/items/(.*)/classification',
  '/api/items/(.*)/moved',
  '/api/items/(.*)/move-failed',
  '/api/items/(.*)/source-missing',
  '/api/items/(.*)/unsupported',
  '/api/taxonomy',  // worker reads taxonomy; also reachable from the browser
])

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return
  if (isWorkerRoute(request)) {
    // Worker routes verify their own auth via lib/require-auth.ts (Clerk M2M
    // tokens are not validated by clerkMiddleware). User sessions can also
    // hit these routes; the route handler decides whether to accept them.
    return
  }

  // Browser routes: require a signed-in Clerk session AND (if configured)
  // restrict to the single owner clerkId. Cortex is a single-operator tool;
  // CORTEX_OWNER_CLERK_ID prevents any other Clerk user that signs up at
  // the same app from seeing the archive.
  const a = await auth.protect()
  const owner = process.env.CORTEX_OWNER_CLERK_ID
  if (owner && a.userId !== owner) {
    return new Response('Forbidden', { status: 403 })
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
