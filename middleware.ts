import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Routes that bypass Clerk auth.
// API routes guarded by their own shared-secret check (requireApiKey / CRON_SECRET) live here —
// the daemon, consumer processes, and Vercel cron need to call them without Clerk sessions.
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/api/ingest(.*)',           // Phase 5/6 — daemon POSTs metadata (requireApiKey)
  '/api/queue(.*)',            // Phase 5/7 — consumer polls queue (requireApiKey)
  '/api/classify(.*)',         // Phase 5/7 — consumer POSTs classification result (requireApiKey)
  '/api/taxonomy/internal(.*)',// Phase 7 — consumer reads taxonomy (requireApiKey)
  '/api/cron(.*)',             // Vercel cron — Drive resolve, embed, taxonomy merge (CRON_SECRET)
])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) await auth.protect()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
