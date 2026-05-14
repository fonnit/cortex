// Auth boundary helper. Two identity kinds:
//   - User session (browser) — Clerk's auth() resolves clerkId → User row.
//   - Machine (worker) — Authorization: Bearer mt_... is verified via
//     clerkClient.m2m.verify() with this app's CLERK_MACHINE_SECRET_KEY.
//
// Each route declares which kinds it accepts via requireAuth(['user'|'machine']).

import { auth } from '@clerk/nextjs/server'
import { createClerkClient } from '@clerk/backend'
import { headers as nextHeaders } from 'next/headers'
import { prisma } from './prisma'
import { HttpError } from './http-error'

export type Identity =
  | { kind: 'user'; userId: string; clerkId: string }
  | { kind: 'machine'; userId: string; machineId: string; tokenId: string }

export type AllowedKind = 'user' | 'machine'

// Cache the Clerk client across requests (one per process).
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
  // M2M opaque tokens start with mt_. JWT-format M2M tokens are also accepted by verify().
  if (!token.startsWith('mt_') && !token.includes('.')) return null

  const secret = process.env.CLERK_MACHINE_SECRET_KEY
  if (!secret) return null  // backend machine secret not configured; can't verify

  try {
    const result = await clerkBackend().m2m.verify({ token, machineSecretKey: secret })
    // result shape: { id, subject, scopes, claims }
    const r = result as { id?: string; subject?: string }
    const tokenId = r.id ?? 'unknown'
    const subject = r.subject ?? 'unknown'

    // Cortex is single-operator by design. Resolve the machine identity to
    // the one User row. Refuse to guess if there's 0 or 2+.
    const users = await prisma.user.findMany({ take: 2, select: { id: true, clerkId: true } })
    if (users.length === 0) {
      throw new HttpError(
        500,
        'No User row in DB — sign in to the web app once before using the worker',
      )
    }
    if (users.length > 1) {
      throw new HttpError(
        500,
        `Cortex v1 is single-owner but found ${users.length} User rows. ` +
        `Either delete the extras or upgrade machine→user mapping. ` +
        `clerkIds: ${users.map((u) => u.clerkId).join(', ')}`,
      )
    }
    return { kind: 'machine', userId: users[0].id, machineId: subject, tokenId }
  } catch (e) {
    if (e instanceof HttpError) throw e
    return null  // verification failed; fall through to user-session check
  }
}

export async function requireAuth(allowed: AllowedKind[]): Promise<Identity> {
  // 1) Try machine auth first (presence of a Bearer header is the signal).
  const machineId = await tryMachineAuth()
  if (machineId) {
    if (!allowed.includes('machine')) {
      throw new HttpError(403, 'Machine token not accepted on this route')
    }
    return machineId
  }

  // 2) Try user session via Clerk.
  const a = await auth()
  const clerkId = a.userId
  if (!clerkId) throw new HttpError(401, 'Unauthorized')
  if (!allowed.includes('user')) {
    throw new HttpError(403, 'User session not accepted on this route')
  }

  // Upsert User row on first sign-in (lazy creation).
  const user = await prisma.user.upsert({
    where: { clerkId },
    create: { clerkId },
    update: {},
  })
  return { kind: 'user', userId: user.id, clerkId }
}
