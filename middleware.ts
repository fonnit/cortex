import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Cortex v1 auth boundary.
//
// Every /api/* route passes through Clerk. There are two identity kinds:
//   - User session (browser) — has clerkId; resolves to User row.
//   - Machine Token (Mac worker) — has machineId; resolves to a User row by
//     convention (single owner). See lib/require-auth.ts.
//
// Route handlers enforce the accepted kind via requireAuth(['user'|'machine']).
// Public routes (no auth) below are sign-in only.

const isPublicRoute = createRouteMatcher(['/sign-in(.*)'])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) await auth.protect()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
