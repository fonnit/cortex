// Clerk Machine Token client. Caches the access_token in memory until 60s
// before expiry. Auto-refreshes on demand. The worker imports getAccessToken()
// and uses it as the Bearer for every API call.

type CachedToken = { value: string; expiresAt: number }
let cached: CachedToken | null = null

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.value
  }

  const domain = process.env.CLERK_DOMAIN
  const clientId = process.env.CORTEX_CLIENT_ID
  const clientSecret = process.env.CORTEX_CLIENT_SECRET
  if (!domain || !clientId || !clientSecret) {
    throw new Error(
      'Missing one of: CLERK_DOMAIN, CORTEX_CLIENT_ID, CORTEX_CLIENT_SECRET',
    )
  }

  const res = await fetch(`${domain.replace(/\/$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Clerk token exchange failed: ${res.status} ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  cached = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return cached.value
}

// Convenience: POST/GET against the Cortex API with Bearer attached + JSON body.
export async function apiFetch(
  pathOrUrl: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const base = process.env.CORTEX_API_BASE_URL?.replace(/\/$/, '')
  if (!base) throw new Error('CORTEX_API_BASE_URL not set')
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`

  const token = await getAccessToken()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init.headers as Record<string, string> | undefined),
  }
  let body = init.body
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  }

  return fetch(url, { ...init, headers, body })
}
