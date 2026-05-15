// Clerk M2M Token client.
//
// Worker (Machine A) flow:
//   1) Has its own machine secret key in CLERK_MACHINE_SECRET_KEY (ak_xxx).
//   2) Before each request, mints a short-lived M2M token (mt_xxx) via
//      clerkClient.m2m.createToken() using that secret.
//   3) Sends Authorization: Bearer mt_xxx to the backend.
//
// Backend (Machine B) has its OWN machine secret key, and verifies the token
// via clerkClient.m2m.verify() with its own secret. The Clerk dashboard scopes
// declare Machine A → Machine B (so verification succeeds only for callers
// explicitly allowed).

import { createClerkClient } from '@clerk/backend'

const TOKEN_TTL_SECONDS = 3600  // 1 hour
const REFRESH_MARGIN_MS = 60_000  // refresh 60s before expiry

type CachedToken = { value: string; expiresAt: number }
let cached: CachedToken | null = null
// Shared in-flight mint so concurrent loops don't each hit Clerk independently
// when the cache is empty/stale. First caller starts the mint; others await it.
let inFlightMint: Promise<string> | null = null

async function mintM2MToken(): Promise<string> {
  const secret = process.env.CLERK_MACHINE_SECRET_KEY
  if (!secret) throw new Error('CLERK_MACHINE_SECRET_KEY not set in agent/.env.daemon')

  const clerk = createClerkClient({ secretKey: secret })
  const m2m = await clerk.m2m.createToken({
    secondsUntilExpiration: TOKEN_TTL_SECONDS,
    machineSecretKey: secret,
  })

  // M2MToken shape: { id, subject, scopes, claims, secret, token? } —
  // .secret holds the bearer value (per docs example).
  const value = (m2m as { secret?: string; token?: string }).secret
    ?? (m2m as { token?: string }).token
  if (!value) throw new Error('createToken() returned no secret/token field')

  cached = {
    value,
    expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
  }
  return value
}

async function getM2MToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - REFRESH_MARGIN_MS) {
    return cached.value
  }
  if (inFlightMint) return inFlightMint
  inFlightMint = (async () => {
    try {
      return await mintM2MToken()
    } finally {
      inFlightMint = null
    }
  })()
  return inFlightMint
}

export async function apiFetch(
  pathOrUrl: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const base = process.env.CORTEX_API_BASE_URL?.replace(/\/$/, '')
  if (!base) throw new Error('CORTEX_API_BASE_URL not set')
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`

  const token = await getM2MToken()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init.headers as Record<string, string> | undefined),
  }
  let body = init.body
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  }

  const res = await fetch(url, { ...init, headers, body })

  // If the cached token was revoked or expired earlier than we tracked,
  // mint a fresh one and retry once.
  if (res.status === 401 && cached) {
    cached = null
    const freshToken = await getM2MToken()
    headers.Authorization = `Bearer ${freshToken}`
    return fetch(url, { ...init, headers, body })
  }

  return res
}
