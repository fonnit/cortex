// Auth gate. Two identity kinds:
//   - user (browser Clerk session)
//   - machine (worker Clerk M2M token)
// No User table, no userId resolution — Cortex is single-operator and the
// middleware's CORTEX_OWNER_CLERK_ID gate filters out anyone else.

import { auth } from '@clerk/nextjs/server'
import { createClerkClient } from '@clerk/backend'
import { headers as nextHeaders } from 'next/headers'
import { HttpError } from './http-error'

export type Identity =
  | { kind: 'user'; clerkId: string }
  | { kind: 'machine'; machineId: string; tokenId: string }

export type AllowedKind = 'user' | 'machine'

let _clerk: ReturnType<typeof createClerkClient> | null = null
function clerkBackend() {
  if (_clerk) return _clerk
  const secret = process.env.CLERK_MACHINE_SECRET_KEY
  if (!secret) {
    throw new HttpError(
      500,
      'CLERK_MACHINE_SECRET_KEY not set on the backend. Add the backend machine\'s ak_ secret to Vercel env.',
    )
  }
  _clerk = createClerkClient({ secretKey: secret })
  return _clerk
}

async function tryMachineAuth(): Promise<Identity | null> {
  const h = await nextHeaders()
  const authHeader = h.get('authorization') ?? h.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token.startsWith('mt_') && !token.includes('.')) return null

  const secret = process.env.CLERK_MACHINE_SECRET_KEY
  if (!secret) return null

  try {
    const result = await clerkBackend().m2m.verify({ token, machineSecretKey: secret })
    const r = result as { id?: string; subject?: string }
    return {
      kind: 'machine',
      machineId: r.subject ?? 'unknown',
      tokenId: r.id ?? 'unknown',
    }
  } catch {
    return null
  }
}

export async function requireAuth(allowed: AllowedKind[]): Promise<Identity> {
  const machine = await tryMachineAuth()
  if (machine) {
    if (!allowed.includes('machine')) {
      throw new HttpError(403, 'Machine token not accepted on this route')
    }
    return machine
  }

  const a = await auth()
  const clerkId = a.userId
  if (!clerkId) throw new HttpError(401, 'Unauthorized')
  if (!allowed.includes('user')) {
    throw new HttpError(403, 'User session not accepted on this route')
  }

  // Owner gate. If CORTEX_OWNER_CLERK_ID is set, only that user may proceed.
  // (The middleware also enforces this; defense-in-depth in case middleware
  // is bypassed via custom routing.)
  const owner = process.env.CORTEX_OWNER_CLERK_ID
  if (owner && clerkId !== owner) {
    throw new HttpError(403, 'You are not the Cortex owner')
  }

  return { kind: 'user', clerkId }
}
