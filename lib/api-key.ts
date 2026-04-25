import type { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

/**
 * Validates the CORTEX_API_KEY shared secret on ingest/queue/classify routes.
 * Returns null on success, a 401 Response with EMPTY body on failure.
 *
 * Per CONTEXT decision: 401 leaks no Item data, no schema hints, no error text.
 *
 * Token comparison uses `crypto.timingSafeEqual` so the comparison time does
 * not depend on which byte first mismatches (review fix [4]). When the input
 * and expected headers differ in length we still perform a same-length
 * comparison against ourselves before returning 401, so a length-mismatch
 * cannot be distinguished from a content mismatch by timing.
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
  const header = request.headers.get('authorization') ?? ''
  const expectedHeader = `Bearer ${expected}`
  if (!safeEqual(header, expectedHeader)) {
    return new Response(null, { status: 401 })
  }
  return null
}

/**
 * Constant-time string comparison.
 *
 * `crypto.timingSafeEqual` itself throws when the buffer lengths differ. We
 * pad by comparing the shorter buffer to itself (an equal-length operation)
 * before returning false, so the wall-clock cost of a length-mismatch path
 * is comparable to a same-length-mismatch path. This is the standard pattern
 * for length-tolerant constant-time auth comparisons.
 *
 * Exported for direct unit testing — the helper has no dependencies on
 * NextRequest/Response so its correctness can be pinned in isolation.
 */
export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) {
    // Same-length self-compare to avoid an obvious early-exit timing channel.
    timingSafeEqual(aBuf, aBuf)
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}
