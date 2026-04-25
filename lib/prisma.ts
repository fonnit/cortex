import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

// Use the WebSocket-backed Pool adapter rather than PrismaNeonHttp because the
// HTTP adapter does NOT support transactions (interactive or implicit). The
// classify route's compound where + nested-JSON updateMany is wrapped by
// Prisma in an implicit transaction; switching to PrismaNeon (Pool over WS)
// removes the "Transactions are not supported in HTTP mode" failure while
// keeping the same Neon serverless backend.
neonConfig.webSocketConstructor = ws

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient
  prismaPool: Pool
}

const pool =
  globalForPrisma.prismaPool ?? new Pool({ connectionString: process.env.DATABASE_URL })

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaNeon(pool),
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaPool = pool
}
