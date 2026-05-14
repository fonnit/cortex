// Clerk Machine Token client.
//
// Clerk's newer Machine Tokens (2024+) give you a single secret in the dashboard
// — you send it directly as `Authorization: Bearer <secret>`. No /oauth/token
// exchange. The Next.js server verifies via @clerk/nextjs's auth() helper.
//
// The worker imports apiFetch() and uses it for every API call.

function getMachineSecret(): string {
  const secret = process.env.CORTEX_MACHINE_SECRET
  if (!secret) {
    throw new Error('Missing CORTEX_MACHINE_SECRET — set it in agent/.env.daemon')
  }
  return secret
}

// Convenience: GET/POST against the Cortex API with Bearer attached + JSON body.
export async function apiFetch(
  pathOrUrl: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const base = process.env.CORTEX_API_BASE_URL?.replace(/\/$/, '')
  if (!base) throw new Error('CORTEX_API_BASE_URL not set')
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${getMachineSecret()}`,
    ...(init.headers as Record<string, string> | undefined),
  }
  let body = init.body
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  }

  return fetch(url, { ...init, headers, body })
}
