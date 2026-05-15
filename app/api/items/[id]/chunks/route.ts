// POST /api/items/[id]/chunks — worker reports embedded chunks for an Item.
//
// One single-statement CTE: insert ItemChunk rows + flip Item.chunkedAt
// atomically. Halfvec values arrive as plain number[] from the worker;
// we format each as the pgvector text shape "[a,b,c,...]" then cast to
// halfvec inside the SQL.
//
// Multi-statement transactions over Neon HTTP are problematic per the
// project's perf pattern (see CLAUDE.md), so this stays a single statement.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const ChunkSchema = z.object({
  ord: z.number().int().nonnegative(),
  text: z.string().min(1),
  embedding: z.array(z.number()).length(512),
})

const Body = z.object({
  chunks: z.array(ChunkSchema).min(1).max(200),
})

function toHalfvecLiteral(vec: number[]): string {
  // pgvector text format: [v1,v2,...] with no spaces. Numbers serialize with
  // JS's default which is fine for the float precision halfvec expects.
  return '[' + vec.join(',') + ']'
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['machine'])
    const { id } = await ctx.params
    const body = Body.parse(await req.json())

    const ids = body.chunks.map(() => randomUUID())
    const ords = body.chunks.map((c) => c.ord)
    const texts = body.chunks.map((c) => c.text)
    const embeddings = body.chunks.map((c) => toHalfvecLiteral(c.embedding))

    // Single CTE: insert chunks, then mark Item.chunkedAt iff insert ran.
    const updated = await prisma.$queryRaw<Array<{ id: string }>>`
      WITH inserted AS (
        INSERT INTO "ItemChunk" (id, "itemId", ord, text, embedding)
        SELECT t.id, ${id}::text, t.ord, t.text, t.emb::halfvec
        FROM unnest(${ids}::text[], ${ords}::int[], ${texts}::text[], ${embeddings}::text[])
             AS t(id, ord, text, emb)
        RETURNING id
      )
      UPDATE "Item"
      SET "chunkedAt" = NOW(),
          "chunkError" = NULL,
          "chunkLeasedAt" = NULL
      WHERE id = ${id}
        AND EXISTS (SELECT 1 FROM inserted)
      RETURNING id
    `

    if (updated.length === 0) {
      const exists = await prisma.item.findUnique({
        where: { id }, select: { id: true, chunkedAt: true },
      })
      if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 })
      // Item exists but the UPDATE didn't fire — usually means inserted CTE was
      // empty (zero chunks; shouldn't happen given min(1) validation above).
      return NextResponse.json({ error: 'no chunks inserted' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, count: body.chunks.length }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/items/[id]/chunks]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
