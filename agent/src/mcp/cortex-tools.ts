/**
 * Stdio MCP server `cortex-tools` — quick task 260428-lx4, Task 2.
 *
 * Exposes 3 read-only tools that proxy to the Next.js cortex API. The Stage 2
 * `claude -p` subprocess (spawned by agent/src/consumer/claude.ts) loads this
 * server via `--mcp-config <tmpfile>` and `--strict-mcp-config`, with
 * `--allowedTools` whitelisting the 3 qualified tool names so the model
 * cannot reach for shell, fs, or any other ambient capability (T-lx4-02).
 *
 * Tools (named without the mcp__cortex__ prefix — the MCP server name is
 * `cortex` so the qualified form Claude sees is `mcp__cortex__cortex_*`):
 *   1. cortex_paths_internal — GET /api/paths/internal
 *   2. cortex_label_samples  — GET /api/labels/samples?axis=&label=[&limit=]
 *   3. cortex_path_feedback  — GET /api/path-feedback[?since=&limit=]
 *
 * Decisions per planner:
 *   D2: @modelcontextprotocol/sdk@^1.29.0 confirmed installable, ESM-native,
 *       Node ≥18, Zod ≥3.25 || ≥4 (we have 4.3.6). Pairs with agent
 *       package.json "type": "module".
 *   D4: tool errors return { isError: true, content: [{ type: 'text', ... }] }
 *       so the model can decide to fall back to 'uncertain'. Server-side
 *       fail-fast was rejected because it would make Stage 2 brittle to a
 *       transient Vercel hiccup.
 *
 * Bootstrap contract (mirrors agent/src/consumer/index.ts):
 *   - Validate env (CORTEX_API_URL + CORTEX_API_KEY) — process.exit(1) on
 *     missing.
 *   - Wire stdio transport — the parent claude subprocess speaks JSON-RPC
 *     over stdin/stdout.
 *   - Skip auto-start under jest (JEST_WORKER_ID).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

/** Tool names exposed (without the mcp__cortex__ prefix). */
export const CORTEX_TOOL_NAMES = [
  'cortex_paths_internal',
  'cortex_label_samples',
  'cortex_path_feedback',
] as const
export type CortexToolName = (typeof CORTEX_TOOL_NAMES)[number]

/** Strict env shape the factory + bootstrap need. */
export interface CortexMcpEnv {
  CORTEX_API_URL?: string
  CORTEX_API_KEY?: string
}

export interface ValidateResult {
  ok: boolean
  missing: string[]
}

/**
 * Pure check — exported for unit tests and for the bootstrap path. Mirrors
 * `validateConsumerEnv` in agent/src/consumer/index.ts.
 */
export function validateMcpEnv(env: CortexMcpEnv): ValidateResult {
  const missing: string[] = []
  if (!env.CORTEX_API_URL) missing.push('CORTEX_API_URL')
  if (!env.CORTEX_API_KEY) missing.push('CORTEX_API_KEY')
  return { ok: missing.length === 0, missing }
}

interface FactoryOpts {
  /** Required at runtime — bootstrap validates before calling the factory. */
  env: { CORTEX_API_URL: string; CORTEX_API_KEY: string }
  /** Injection seam for tests. Defaults to global fetch. */
  fetchImpl?: typeof globalThis.fetch
}

/**
 * Build an MCP request URL. Query params are URL-encoded individually.
 * Pure helper — exported for unit testing.
 */
function buildUrl(
  base: string,
  path: string,
  params: Array<[string, string | number | undefined]>,
): string {
  const filtered = params.filter(
    ([, v]) => v !== undefined && v !== '' && v !== null,
  ) as Array<[string, string | number]>
  if (filtered.length === 0) return `${base}${path}`
  const qs = filtered
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join('&')
  return `${base}${path}?${qs}`
}

/**
 * Generic tool body: do the GET, return the JSON body verbatim as a text-typed
 * tool result. On non-2xx return { isError: true, content: [...] } so the
 * model can decide to fall back to 'uncertain' (D4).
 */
async function proxyGet(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  apiKey: string,
): Promise<{
  isError?: boolean
  content: Array<{ type: 'text'; text: string }>
}> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `cortex API error: network ${(err as Error).message ?? String(err)}`,
        },
      ],
    }
  }

  if (!res.ok) {
    let bodyText = ''
    try {
      bodyText = await res.text()
    } catch {
      /* ignore — bodyText stays empty */
    }
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `cortex API error: ${res.status} ${bodyText}`.trim(),
        },
      ],
    }
  }

  const json = await res.json()
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
  }
}

/**
 * Factory — returns a configured McpServer with the 3 cortex_* tools registered.
 * Caller is responsible for connecting a transport and starting it.
 */
export function createCortexMcpServer(opts: FactoryOpts): McpServer {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const { CORTEX_API_URL, CORTEX_API_KEY } = opts.env

  const server = new McpServer(
    { name: 'cortex', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  // 1) cortex_paths_internal — no args.
  server.tool(
    'cortex_paths_internal',
    'List existing confirmed-folder parents (with file counts) so Stage 2 can pick a path that reuses existing structure. Returns up to 50 parents sorted by file count desc.',
    {},
    async () => {
      const url = buildUrl(CORTEX_API_URL, '/api/paths/internal', [])
      return proxyGet(fetchImpl, url, CORTEX_API_KEY)
    },
  )

  // 2) cortex_label_samples — axis (enum), label (string), limit (optional number).
  server.tool(
    'cortex_label_samples',
    "Sample up to N most-recent confirmed items carrying a particular axis label, so Claude can ground a placement decision in real prior items. axis must be one of 'type'|'from'|'context'.",
    {
      axis: z.enum(['type', 'from', 'context']),
      label: z.string().min(1),
      limit: z.number().int().positive().max(20).optional(),
    },
    async ({ axis, label, limit }) => {
      const url = buildUrl(CORTEX_API_URL, '/api/labels/samples', [
        ['axis', axis],
        ['label', label],
        ['limit', limit],
      ])
      return proxyGet(fetchImpl, url, CORTEX_API_KEY)
    },
  )

  // 3) cortex_path_feedback — since (optional ISO string), limit (optional number).
  server.tool(
    'cortex_path_feedback',
    'Recent user moves: rows where Stage 2 proposed one path but the user filed under a different one. Useful before committing a placement. Default window: last 30 days.',
    {
      since: z.string().min(1).optional(),
      limit: z.number().int().positive().max(50).optional(),
    },
    async ({ since, limit }) => {
      const url = buildUrl(CORTEX_API_URL, '/api/path-feedback', [
        ['since', since],
        ['limit', limit],
      ])
      return proxyGet(fetchImpl, url, CORTEX_API_KEY)
    },
  )

  return server
}

/* ------------------------------------------------------------------ */
/* Auto-start (skipped under jest)                                     */
/* ------------------------------------------------------------------ */

/**
 * Bootstrap: validate env, build server, wire stdio transport. Exits 1 with
 * a clear stderr message on missing env (mirrors consumer-bootstrap pattern).
 */
async function startStdioServer(): Promise<void> {
  const env = process.env as CortexMcpEnv
  const check = validateMcpEnv(env)
  if (!check.ok) {
    console.error(
      `[cortex-mcp] FATAL: missing required env: ${check.missing.join(', ')}`,
    )
    process.exit(1)
    return // unreachable
  }
  const server = createCortexMcpServer({
    env: {
      CORTEX_API_URL: env.CORTEX_API_URL!,
      CORTEX_API_KEY: env.CORTEX_API_KEY!,
    },
  })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // Server keeps running until the parent claude subprocess closes stdin.
}

const isTest =
  process.env.JEST_WORKER_ID !== undefined ||
  process.env.NODE_ENV === 'test'
if (!isTest) {
  startStdioServer().catch((err) => {
    console.error('[cortex-mcp] startup threw:', err)
    process.exit(1)
  })
}
