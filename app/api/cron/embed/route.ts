import { NextRequest } from 'next/server'
import Langfuse from 'langfuse'
import { prisma } from '@/lib/prisma'
import { embedTexts, buildEmbedText } from '@/lib/embed'

export async function POST(request: NextRequest) {
  // T-04-01: Validate CRON_SECRET header
  if (
    request.headers.get('authorization') !==
    `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    // Fetch up to 50 filed items with no embedding (T-04-03: hard cap at 50)
    const items = await prisma.item.findMany({
      where: { status: 'filed', embedding: null },
      take: 50,
      select: {
        id: true,
        user_id: true,
        filename: true,
        axis_type: true,
        axis_from: true,
        source_metadata: true,
      },
    })

    if (items.length === 0) {
      return Response.json({ embedded: 0 })
    }

    const texts = items.map((item) => buildEmbedText(item))

    // Langfuse observability: wrap the OpenAI call in a trace + span
    const lf = new Langfuse()
    const trace = lf.trace({ name: 'embed-cron', metadata: { count: items.length } })
    const span = trace.span({ name: 'openai-embed', input: { count: items.length } })

    const vectors = await embedTexts(texts)

    span.end({ output: { embedded: items.length } })
    void lf.flushAsync().catch(() => { /* best-effort */ })

    // Write each embedding via raw SQL — Prisma's typed client cannot write
    // halfvec natively. $queryRaw binds the literal as a string and Postgres
    // applies the ::halfvec cast. We use $queryRaw (not $executeRaw) to mirror
    // the queue route refactor and keep one Prisma raw-SQL surface across
    // routes; the UPDATE has no RETURNING so the discarded result is fine.
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const vector = vectors[i]
      await prisma.$queryRaw`
        UPDATE "Item"
        SET embedding = ${`[${vector.join(',')}]`}::halfvec
        WHERE id = ${item.id}
      `
    }

    return Response.json({ embedded: items.length })
  } catch (err) {
    console.error('[cron/embed] error:', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
