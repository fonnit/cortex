// Auth boundary helper. Returns identity kind + canonical User.id for the
// caller. Browser sessions return kind='user'; Clerk API Keys (Bearer `ak_...`
// sent by the Mac worker) return kind='machine'.
//
// Each route declares which kinds it accepts via requireAuth(['user'|'machine']).
//
// For v1: machine-token routes resolve to the single owner User row (the User
// with the lowest createdAt). Multi-owner setups would map the API key's
// `subject` claim to a specific User.

import { auth } from '@clerk/nextjs/server'
import { prisma } from './prisma'
import { HttpError } from './http-error'

export type Identity =
  | { kind: 'user'; userId: string; clerkId: string }
  | { kind: 'machine'; userId: string; machineId: string }

export type AllowedKind = 'user' | 'machine'

export async function requireAuth(allowed: AllowedKind[]): Promise<Identity> {
  const a = await auth()

  // Clerk machine-token shape:
  //   { tokenType: 'api_key' | 'm2m_token' | 'oauth_token',
  //     id: string,          // the token id, e.g. ak_xxx
  //     subject: string,     // the user/machine this token is bound to
  //     scopes: string[],
  //     isAuthenticated: true }
  const ax = a as unknown as {
    tokenType?: string
    id?: string
    subject?: string
    isAuthenticated?: boolean
  }

  const isMachine = ax.tokenType === 'api_key'
    || ax.tokenType === 'm2m_token'
    || ax.tokenType === 'oauth_token'

  if (isMachine) {
    if (!allowed.includes('machine')) {
      throw new HttpError(403, 'Machine token not accepted on this route')
    }
    // v1: single owner. Resolve to the oldest User row.
    const owner = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!owner) {
      throw new HttpError(
        500,
        'No User row in DB — sign in to the web app once before using the worker',
      )
    }
    return { kind: 'machine', userId: owner.id, machineId: ax.id ?? 'unknown' }
  }

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
