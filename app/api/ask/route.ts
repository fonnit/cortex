import Anthropic from '@anthropic-ai/sdk'
import Langfuse from 'langfuse'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { embedTexts } from '@/lib/embed'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const schema = z.object({ question: z.string().min(1).max(1000) })

interface AskResponse {
  answer: Array<{ text: string; cites: number[] }>
  sources: Array<{
    n: number
    title: string
    path: string
    when: string
  }>
  latencyMs: number
}

export async function POST(request: Request) {
  let userId: string
  try {
    userId = await requireAuth()
  } catch (err) {
    if (err instanceof Response) return err
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { question: string }
  try {
    const raw = await request.json()
    body = schema.parse(raw)
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const lf = new Langfuse()
  const trace = lf.trace({ name: 'ask', userId, input: { question: body.question } })

  try {
    const t0 = Date.now()

    // Embed query
    const embedSpan = trace.span({ name: 'embed-query', input: { text: body.question } })
    const vectors = await embedTexts([body.question])
    const queryVec = vectors[0]
    embedSpan.end({ output: { dims: queryVec.length } })

    // ANN retrieval — raw SQL required for halfvec <#> operator
    const retrieveSpan = trace.span({ name: 'pgvector-ann', input: { limit: 20 } })
    const vecStr = `[${queryVec.join(',')}]`
    const rows = await prisma.$queryRaw<Array<{
      id: string
      filename: string | null
      axis_type: string | null
      axis_from: string | null
      axis_context: string | null
      confirmed_drive_path: string | null
      proposed_drive_path: string | null
      ingested_at: string | Date
      source_metadata: Record<string, unknown> | null
    }>>`
      SELECT id, filename, axis_type, axis_from, axis_context,
             confirmed_drive_path, proposed_drive_path, ingested_at,
             source_metadata
      FROM "Item"
      WHERE user_id = ${userId}
        AND status = 'filed'
        AND embedding IS NOT NULL
      ORDER BY embedding <#> ${vecStr}::halfvec
      LIMIT 20
    `
    retrieveSpan.end({ output: { count: rows.length } })

    // Top 5 candidates for synthesis
    const top5 = rows.slice(0, 5)

    const docLines = top5.map((row, i) => {
      const drivePath =
        (row.confirmed_drive_path as string | null) ??
        (row.proposed_drive_path as string | null) ??
        'unknown'
      const filedDate = new Date(row.ingested_at as string).toISOString().slice(0, 10)
      return `[${i + 1}] filename: ${(row.filename as string | null) ?? 'untitled'} | path: ${drivePath} | type: ${(row.axis_type as string | null) ?? 'unknown'} | filed: ${filedDate}`
    })

    const systemPrompt = [
      'You are Cortex, a personal AI assistant. Answer the question using ONLY the provided documents.',
      'Cite sources inline as [1], [2], etc. Use only citation numbers that correspond to listed documents.',
      'Limit to ≤5 distinct citations. Be concise. Output ONLY the answer text with inline [N] citations — no preamble.',
      '',
      'Documents:',
      ...docLines,
    ].join('\n')

    // Haiku synthesis
    const synthSpan = trace.span({ name: 'haiku-synthesis', input: { docs: top5.length } })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: body.question }],
    })
    const rawAnswer = msg.content[0].type === 'text' ? msg.content[0].text : ''
    synthSpan.end({ output: { chars: rawAnswer.length } })

    // Parse answer into paragraphs with cite arrays
    const paragraphs = rawAnswer
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    const answer = paragraphs.map((p) => ({
      text: p.replace(/\[(\d+)\]/g, '').trim(),
      cites: [...p.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
    }))

    const sources = top5.map((row, i) => ({
      n: i + 1,
      title:
        (row.filename as string | null) ??
        ((row.source_metadata as Record<string, unknown> | null)?.subject as string | undefined) ??
        'untitled',
      path:
        (row.confirmed_drive_path as string | null) ??
        (row.proposed_drive_path as string | null) ??
        'unknown',
      when: new Date(row.ingested_at as string).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    }))

    const latencyMs = Date.now() - t0

    trace.update({ output: { citations: top5.length, latencyMs } })
    await lf.flushAsync()

    const response: AskResponse = { answer, sources, latencyMs }
    return Response.json(response)
  } catch (err) {
    console.error('[/api/ask] error:', err)
    trace.update({ output: { error: String(err) } })
    await lf.flushAsync()
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
