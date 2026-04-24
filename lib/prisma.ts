import { PrismaClient } from '@prisma/client'
import { PrismaNeonHttp } from '@prisma/adapter-neon'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {}),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
