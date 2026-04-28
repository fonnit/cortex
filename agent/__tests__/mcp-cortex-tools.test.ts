/**
 * Stdio MCP server `cortex-tools` — quick task 260428-lx4, Task 2.
 *
 * Tests use an in-memory transport pair (Client ↔ Server) so we exercise tool
 * wiring end-to-end without spawning a subprocess. fetchImpl is injected so the
 * proxy never hits the real network. Coverage:
 *   - cortex_paths_internal: GET /api/paths/internal with bearer.
 *   - cortex_label_samples: GET /api/labels/samples?axis=&label=[&limit=].
 *     URL-encodes label.
 *   - cortex_path_feedback: GET /api/path-feedback[?since=&limit=].
 *   - input-arg validation rejects malformed args (server returns isError).
 *   - non-2xx HTTP response → tool result is { isError, content: text } —
 *     server keeps running.
 *   - validateMcpEnv reports missing CORTEX_API_URL / CORTEX_API_KEY.
 *   - createCortexMcpServer factory returns a Server with the 3 tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  createCortexMcpServer,
  validateMcpEnv,
  CORTEX_TOOL_NAMES,
} from '../src/mcp/cortex-tools'

const ENV = {
  CORTEX_API_URL: 'https://cortex.example.com',
  CORTEX_API_KEY: 'sekret-token',
} as const

interface FetchCall {
  url: string
  init?: RequestInit
}

function recordingFetchImpl(
  responses: Array<{ status: number; body: unknown } | (() => { status: number; body: unknown })>,
  calls?: FetchCall[],
): typeof globalThis.fetch {
  let i = 0
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls?.push({ url, init })
    const next = responses[i] ?? responses[responses.length - 1]
    const r = typeof next === 'function' ? next() : next
    i += 1
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof globalThis.fetch
}

async function withConnectedClient(
  server: McpServer,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(clientTransport)
  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

/* ------------------------------------------------------------------ */
/* validateMcpEnv                                                      */
/* ------------------------------------------------------------------ */

describe('validateMcpEnv', () => {
  it('returns ok=true with empty missing[] when both vars are present', () => {
    const res = validateMcpEnv({ CORTEX_API_URL: 'x', CORTEX_API_KEY: 'y' })
    expect(res).toEqual({ ok: true, missing: [] })
  })

  it('reports missing CORTEX_API_URL', () => {
    const res = validateMcpEnv({ CORTEX_API_KEY: 'y' })
    expect(res.ok).toBe(false)
    expect(res.missing).toEqual(['CORTEX_API_URL'])
  })

  it('reports missing CORTEX_API_KEY', () => {
    const res = validateMcpEnv({ CORTEX_API_URL: 'x' })
    expect(res.ok).toBe(false)
    expect(res.missing).toEqual(['CORTEX_API_KEY'])
  })

  it('reports both missing', () => {
    const res = validateMcpEnv({})
    expect(res.ok).toBe(false)
    expect(res.missing.sort()).toEqual(['CORTEX_API_KEY', 'CORTEX_API_URL'])
  })
})

/* ------------------------------------------------------------------ */
/* Factory + tool list                                                 */
/* ------------------------------------------------------------------ */

describe('createCortexMcpServer factory', () => {
  it('Test 7: returns a server with the 3 cortex_* tools registered', async () => {
    const server = createCortexMcpServer({
      env: ENV,
      fetchImpl: recordingFetchImpl([{ status: 200, body: { ok: true } }]),
    })
    const { client, close } = await withConnectedClient(server)
    try {
      const list = await client.listTools()
      const names = list.tools.map((t) => t.name).sort()
      expect(names).toEqual(
        [...CORTEX_TOOL_NAMES].sort(),
      )
      expect(names).toContain('cortex_paths_internal')
      expect(names).toContain('cortex_label_samples')
      expect(names).toContain('cortex_path_feedback')
    } finally {
      await close()
    }
  })
})

/* ------------------------------------------------------------------ */
/* cortex_paths_internal                                                */
/* ------------------------------------------------------------------ */

describe('tool: cortex_paths_internal', () => {
  it('Test 1: fetches GET /api/paths/internal with Bearer header; returns body verbatim', async () => {
    const calls: FetchCall[] = []
    const server = createCortexMcpServer({
      env: ENV,
      fetchImpl: recordingFetchImpl(
        [{ status: 200, body: { paths: [{ parent: '/x/', count: 3 }] } }],
        calls,
      ),
    })
    const { client, close } = await withConnectedClient(server)
    try {
      const result = await client.callTool({
        name: 'cortex_paths_internal',
        arguments: {},
      })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://cortex.example.com/api/paths/internal')
      const auth = (calls[0].init?.headers as Record<string, string>)['Authorization']
      expect(auth).toBe('Bearer sekret-token')

      // result.content is text-typed — body is JSON-stringified.
      const content = (result.content as Array<{ type: string; text: string }>)[0]
      expect(content.type).toBe('text')
      expect(JSON.parse(content.text)).toEqual({
        paths: [{ parent: '/x/', count: 3 }],
      })
      expect((result as { isError?: boolean }).isError).not.toBe(true)
    } finally {
      await close()
    }
  })
})

/* ------------------------------------------------------------------ */
/* cortex_label_samples                                                 */
/* ------------------------------------------------------------------ */

describe('tool: cortex_label_samples', () => {
  it('Test 2: builds URL with axis + label (URL-encoded); omits limit when not provided', async () => {
    const calls: FetchCall[] = []
    const server = createCortexMcpServer({
      env: ENV,
      fetchImpl: recordingFetchImpl(
        [{ status: 200, body: { samples: [] } }],
        calls,
      ),
    })
    const { client, close } = await withConnectedClient(server)
    try {
      await client.callTool({
        name: 'cortex_label_samples',
        arguments: { axis: 'type', label: 'invoice & receipts' },
      })
      expect(calls).toHaveLength(1)
      // URL-encodes the label (space → %20, & → %26)
      expect(calls[0].url).toBe(
        'https://cortex.example.com/api/labels/samples?axis=type&label=invoice%20%26%20receipts',
      )
    } finally {
      await close()
    }
  })

  it('Test 2b: appends limit when provided', async () => {
    const calls: FetchCall[] = []
    const server = createCortexMcpServer({
      env: ENV,
      fetchImpl: recordingFetchImpl(
        [{ status: 200, body: { samples: [] } }],
        calls,
      ),
    })
    const { client, close } = await withConnectedClient(server)
    try {
      await client.callTool({
        name: 'cortex_label_samples',
        arguments: { axis: 'from', label: 'acme', limit: 7 },
      })
      expect(calls[0].url).toBe(
        'https://cortex.example.com/api/labels/samples?axis=from&label=acme&limit=7',
      )
    } finally {
      await close()
    }
  })

  it('Test 4: input-arg validation — invalid axis returns an MCP error result (server stays alive)', async () => {
    const server = createCortexMcpServer({
      env: ENV,
      fetchImpl: recordingFetchImpl([{ status: 200, body: { ok: true } }]),
    })
    const { client, close } = await withConnectedClient(server)
    try {
      // The MCP SDK's tool-input validation throws — assert that the call
      // resolves to an error result OR rejects with a structured error.
      let saw: unknown
      try {
        const r = await client.callTool({
          name: 'cortex_label_samples',
          arguments: { axis: 'bogus', label: 'x' },
        })
        saw = r
      } catch (err) {
        saw = err
      }
      // Either an isError tool result or a thrown MCP error — both indicate
      // the malformed input did not silently succeed.
      const ok =
        (saw as { isError?: boolean })?.isError === true ||
        saw instanceof Error
      expect(ok).toBe(true)
    } finally {
      await close()
    }
  })
})

/* ------------------------------------------------------------------ */
/* cortex_path_feedback                                                 */
/* ------------------------------------------------------------------ */

describe('tool: cortex_path_feedback', () => {
  it('Test 3a: fetches GET /api/path-feedback with no query params when none given', async () => {
    const calls: FetchCall[] = []
    const server = createCortexMcpServer({
      env: ENV,
      fetchImpl: recordingFetchImpl(
        [{ status: 200, body: { feedback: [] } }],
        calls,
      ),
    })
    const { client, close } = await withConnectedClient(server)
    try {
      await client.callTool({
        name: 'cortex_path_feedback',
        arguments: {},
      })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://cortex.example.com/api/path-feedback')
    } finally {
      await close()
    }
  })

  it('Test 3b: appends since + limit when provided', async () => {
    const calls: FetchCall[] = []
    const server = createCortexMcpServer({
      env: ENV,
      fetchImpl: recordingFetchImpl(
        [{ status: 200, body: { feedback: [] } }],
        calls,
      ),
    })
    const { client, close } = await withConnectedClient(server)
    try {
      const since = '2026-04-01T00:00:00.000Z'
      await client.callTool({
        name: 'cortex_path_feedback',
        arguments: { since, limit: 30 },
      })
      // since is URL-encoded; limit is appended numerically.
      expect(calls[0].url).toBe(
        `https://cortex.example.com/api/path-feedback?since=${encodeURIComponent(
          since,
        )}&limit=30`,
      )
    } finally {
      await close()
    }
  })
})

/* ------------------------------------------------------------------ */
/* Test 5: non-2xx response → isError                                  */
/* ------------------------------------------------------------------ */

describe('error handling: non-2xx HTTP response', () => {
  it('Test 5: 500 from the API → tool result is { isError: true, content: [{ type: text, text: "cortex API error: 500 ..." }] }', async () => {
    const fetchImpl = (async () => {
      return new Response('boom', { status: 500 })
    }) as typeof globalThis.fetch
    const server = createCortexMcpServer({ env: ENV, fetchImpl })
    const { client, close } = await withConnectedClient(server)
    try {
      const result = await client.callTool({
        name: 'cortex_paths_internal',
        arguments: {},
      })
      expect((result as { isError?: boolean }).isError).toBe(true)
      const content = (result.content as Array<{ type: string; text: string }>)[0]
      expect(content.type).toBe('text')
      expect(content.text).toMatch(/cortex API error: 500/)
    } finally {
      await close()
    }
  })

  it('error handling: a follow-up successful call still works (server stays alive)', async () => {
    let i = 0
    const fetchImpl = (async () => {
      i += 1
      if (i === 1) return new Response('boom', { status: 500 })
      return new Response(JSON.stringify({ paths: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof globalThis.fetch
    const server = createCortexMcpServer({ env: ENV, fetchImpl })
    const { client, close } = await withConnectedClient(server)
    try {
      const r1 = await client.callTool({
        name: 'cortex_paths_internal',
        arguments: {},
      })
      expect((r1 as { isError?: boolean }).isError).toBe(true)
      const r2 = await client.callTool({
        name: 'cortex_paths_internal',
        arguments: {},
      })
      expect((r2 as { isError?: boolean }).isError).not.toBe(true)
    } finally {
      await close()
    }
  })
})
