// POST /api/ask — natural-language Q&A over the filed archive.
//
// Pipeline:
//   1. Embed the question via OpenAI text-embedding-3-small @ 512 dims.
//   2. pgvector similarity search over ItemChunk (top-k=8, halfvec <=>).
//   3. Join with Item to get filename + final path + status for citations.
//   4. Build a Haiku synthesis prompt with chunk markers + the question.
//   5. Parse Haiku's structured JSON output → resolve citation chunkIds back
//      to itemId/finalPath/snippet from the retrieved set.
//
// runtime = 'nodejs' (Prisma adapter + OpenAI SDK + Anthropic SDK all want Node).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { ItemStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

const EMBED_MODEL = 'text-embedding-3-small'
const EMBED_DIMENSIONS = 512
const HAIKU_MODEL = process.env.CORTEX_ANSWER_MODEL || 'claude-haiku-4-5'
const TOP_K = 8
const SNIPPET_CHARS = 200
const HAIKU_TIMEOUT_MS = 60_000

const Body = z.object({
  question: z.string().trim().min(1).max(2000),
})

type ChunkHit = {
  chunkId: string
  itemId: string
  text: string
  ord: number
  itemStatus: ItemStatus
  finalPath: string | null
  finalFilename: string | null
  suggestedFilename: string | null
  folderPath: string | null
  distance: number
}

const HaikuResponseSchema = z.object({
  answer: z.string(),
  citationChunkIds: z.array(z.string()).default([]),
})

export async function POST(req: Request) {
  try {
    await requireAuth(['user'])
    const { question } = Body.parse(await req.json())

    // 1. Embed the question.
    const openai = new OpenAI()
    const embRes = await openai.embeddings.create({
      model: EMBED_MODEL,
      dimensions: EMBED_DIMENSIONS,
      input: [question],
      encoding_format: 'float',
    })
    const qEmbedding = embRes.data[0]?.embedding as number[] | undefined
    if (!qEmbedding || qEmbedding.length !== EMBED_DIMENSIONS) {
      return NextResponse.json({ error: 'embedding failed' }, { status: 502 })
    }
    const qLiteral = '[' + qEmbedding.join(',') + ']'

    // 2. + 3. Vector similarity over ItemChunk + join with Item/Folder for
    //         citation metadata. Single $queryRaw on the HTTP transport.
    const hits = await prisma.$queryRaw<ChunkHit[]>`
      SELECT
        c.id                          AS "chunkId",
        c."itemId"                    AS "itemId",
        c.text                        AS "text",
        c.ord                         AS "ord",
        i.status                      AS "itemStatus",
        i."finalPath"                 AS "finalPath",
        i."finalFilename"             AS "finalFilename",
        i."suggestedFilename"         AS "suggestedFilename",
        f."path"                      AS "folderPath",
        (c.embedding <=> ${qLiteral}::halfvec)::float8 AS "distance"
      FROM "ItemChunk" c
      JOIN "Item" i ON i.id = c."itemId"
      LEFT JOIN "Folder" f ON f.id = i."folderId"
      ORDER BY c.embedding <=> ${qLiteral}::halfvec
      LIMIT ${TOP_K}
    `

    if (hits.length === 0) {
      return NextResponse.json({
        answer: "Your archive doesn't have anything yet. Add and approve files via /triage and ask again.",
        citations: [],
      }, { status: 200 })
    }

    // 4. Build the Haiku synthesis prompt.
    const chunkBlock = hits.map((h) => {
      const filename = h.finalFilename ?? h.suggestedFilename ?? '(unnamed)'
      const folder = h.folderPath ?? '(unfiled)'
      return [
        `[chunk-id: ${h.chunkId}]`,
        `filename: ${filename}`,
        `folder: ${folder}`,
        `text: ${h.text}`,
      ].join('\n')
    }).join('\n\n---\n\n')

    const systemPrompt = [
      `You answer questions about Daniel's personal document archive.`,
      `You will be given CHUNKS retrieved by similarity to the question. Each CHUNK has a unique chunk-id.`,
      ``,
      `Rules:`,
      `- Answer using ONLY the information in the CHUNKS. Don't invent facts.`,
      `- Be concise and direct. One short paragraph or a single sentence when that suffices.`,
      `- Cite every CHUNK whose information you used in the answer, by its chunk-id.`,
      `- If the CHUNKS don't contain the answer, say so plainly and return an empty citation list.`,
      ``,
      `Output STRICTLY a JSON object matching this schema:`,
      `{`,
      `  "answer": "<your concise answer>",`,
      `  "citationChunkIds": ["<chunk-id>", "<chunk-id>", ...]`,
      `}`,
      ``,
      `Do NOT add commentary, markdown, or code fences. Output only the JSON.`,
    ].join('\n')

    const userContent = `CHUNKS:\n\n${chunkBlock}\n\nQUESTION: ${question}`

    // 5. Call Haiku.
    const anthropic = new Anthropic()
    const haikuRes = await anthropic.messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      },
      { timeout: HAIKU_TIMEOUT_MS },
    )

    const textBlock = haikuRes.content.find((b) => b.type === 'text') as
      | { type: 'text'; text: string }
      | undefined
    if (!textBlock) {
      return NextResponse.json({ error: 'haiku returned no text block' }, { status: 502 })
    }

    const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '')
    let parsed
    try {
      parsed = HaikuResponseSchema.parse(JSON.parse(raw))
    } catch (e) {
      // Surface the raw output to the UI rather than 500ing — useful debug signal.
      return NextResponse.json({
        answer: textBlock.text,
        citations: [],
        warning: 'haiku output did not match expected schema',
      }, { status: 200 })
    }

    // Resolve citationChunkIds back to retrieved hits. Ignore hallucinated IDs.
    const hitById = new Map(hits.map((h) => [h.chunkId, h]))
    const citations = parsed.citationChunkIds
      .map((cid) => hitById.get(cid))
      .filter((h): h is ChunkHit => !!h)
      .map((h) => ({
        itemId: h.itemId,
        status: h.itemStatus,
        finalPath: h.finalPath,
        finalFilename: h.finalFilename ?? h.suggestedFilename,
        folderPath: h.folderPath,
        snippet: h.text.slice(0, SNIPPET_CHARS),
        distance: h.distance,
      }))

    return NextResponse.json({
      answer: parsed.answer,
      citations,
    }, { status: 200 })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid body', issues: e.issues }, { status: 400 })
    }
    console.error('[POST /api/ask]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
