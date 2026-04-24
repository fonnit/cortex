// Prisma 7 configuration — connection URLs moved out of schema.prisma
// See: https://pris.ly/d/config-datasource
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // DATABASE_URL is required for migrate/push commands; not needed for validate/generate
  ...(process.env.DATABASE_URL && {
    datasource: {
      url: process.env.DATABASE_URL,
    },
  }),
})
