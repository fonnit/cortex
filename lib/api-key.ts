import type { NextRequest } from 'next/server'

/**
 * Validates the CORTEX_API_KEY shared secret on ingest/queue/classify routes.
 * Returns null on success, a 401 Response with EMPTY body on failure.
 *
 * Per CONTEXT decision: 401 leaks no Item data, no schema hints, no error text.
 *
 * Usage at the top of a route handler:
 *   const unauthorized = requireApiKey(request)
 *   if (unauthorized) return unauthorized
 */
export function requireApiKey(request: NextRequest | Request): Response | null {
  const expected = process.env.CORTEX_API_KEY
  if (!expected) {
    // Fail-closed: never authorize when the secret is unset.
    return new Response(null, { status: 401 })
  }
  const header = request.headers.get('authorization')
  if (header !== `Bearer ${expected}`) {
    return new Response(null, { status: 401 })
  }
  return null
}
