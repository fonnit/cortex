// Prisma 7 configuration — connection URLs moved out of schema.prisma
// See: https://pris.ly/d/config-datasource
import path from 'node:path'
import { loadEnvFile } from 'node:process'
import { defineConfig } from 'prisma/config'

try { loadEnvFile(path.resolve('.env.local')) } catch {}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
})
