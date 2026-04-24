// Re-export auth for use in Server Components
export { auth } from '@clerk/nextjs/server'

/**
 * requireAuth — use in Route Handlers to extract a verified userId.
 * Throws a 401 Response if the session is missing or invalid.
 *
 * Note: TriageView keyboard handler must check
 * `document.querySelector('[data-clerk-modal]')` before processing keys
 * to prevent Clerk modal keyboard events from being captured by the triage UI.
 */
export async function requireAuth(): Promise<string> {
  const { auth } = await import('@clerk/nextjs/server')
  const { userId } = await auth()
  if (!userId) throw new Response('Unauthorized', { status: 401 })
  return userId
}
