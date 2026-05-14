// Auth boundary helper. Returns identity kind + canonical User.id for the
// caller. Browser sessions return kind='user'; Clerk Machine Tokens (worker)
// return kind='machine'. Each route declares which kinds it accepts.
//
// Maps Clerk's session claims onto Cortex's User row by clerkId. For machine
// tokens, the User row is the User this Machine was registered against in the
// Clerk dashboard (machine tokens carry an associated user via the userId
// claim, or fall back to a single-owner User if not present).

import { auth } from '@clerk/nextjs/server'
import { prisma } from './prisma'
import { HttpError } from './http-error'

export type Identity =
  | { kind: 'user'; userId: string; clerkId: string }
  | { kind: 'machine'; userId: string; machineId: string }

export type AllowedKind = 'user' | 'machine'

// Resolves Clerk auth() → Cortex User.id. Throws 401 if unauthenticated,
// 403 if the caller's identity kind isn't in `allowed`.
export async function requireAuth(allowed: AllowedKind[]): Promise<Identity> {
  const a = await auth()

  // Clerk Machine Tokens: a.machineId / a.tokenType === 'machine_token' (Clerk 7+)
  // Different Clerk versions expose this differently; check both shapes.
  const ax = a as unknown as { machineId?: string; tokenType?: string; sessionClaims?: { sub?: string; userId?: string } }
  const machineId = ax.machineId
    ?? (ax.tokenType === 'machine_token' ? ax.sessionClaims?.sub : undefined)

  if (machineId) {
    if (!allowed.includes('machine')) {
      throw new HttpError(403, 'Machine token not accepted on this route')
    }
    // Machine tokens are bound to a User in Clerk dashboard; we accept the
    // single owner User by convention for v1. Multi-machine setups would
    // store machineId → User.id mapping here.
    const owner = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!owner) {
      throw new HttpError(500, 'No User row in DB — sign in once before using the worker')
    }
    return { kind: 'machine', userId: owner.id, machineId }
  }

  const clerkId = a.userId
  if (!clerkId) throw new HttpError(401, 'Unauthorized')
  if (!allowed.includes('user')) {
    throw new HttpError(403, 'User session not accepted on this route')
  }

  // Upsert User row on first auth (lazy creation).
  const user = await prisma.user.upsert({
    where: { clerkId },
    create: { clerkId },
    update: {},
  })
  return { kind: 'user', userId: user.id, clerkId }
}
