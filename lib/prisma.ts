import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

// Use the WebSocket-backed adapter rather than PrismaNeonHttp because the
// HTTP adapter does NOT support transactions (interactive or implicit). The
// classify route's compound where + nested-JSON updateMany is wrapped by
// Prisma in an implicit transaction; PrismaNeon (over WS) supports it.
neonConfig.webSocketConstructor = ws

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const url = process.env.DATABASE_URL ?? ''
const isNeon = url.includes('neon.tech') || url.includes('.neon.') || url.includes('pooler.')

const adapter = isNeon
  ? new PrismaNeon({ connectionString: url })
  : new PrismaPg({ connectionString: url })

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
