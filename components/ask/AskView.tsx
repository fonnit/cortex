'use client'

// /ask — natural-language Q&A over the filed archive.
// Single textbox, blocking POST to /api/ask, answer card + citation pills.

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

type Citation = {
  itemId: string
  status: string
  finalPath: string | null
  finalFilename: string | null
  folderPath: string | null
  snippet: string
  distance: number
}

type AskResponse = {
  answer: string
  citations: Citation[]
  warning?: string
}

async function askApi(question: string): Promise<AskResponse> {
  const r = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

export function AskView() {
  const [draft, setDraft] = useState('')
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null)

  const ask = useMutation({
    mutationFn: askApi,
  })

  const submit = () => {
    const q = draft.trim()
    if (!q || ask.isPending) return
    setLastQuestion(q)
    setExpandedCitation(null)
    ask.mutate(q)
  }

  return (
    <div className="cx-ask-main">
      <div className="cx-ask-input">
        <span className="cx-ask-prompt">Ask</span>
        <input
          className="cx-ask-field"
          type="text"
          value={draft}
          placeholder="e.g. what's my passport number?"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          autoFocus
        />
        <button
          className="cx-action cx-action-primary"
          onClick={submit}
          disabled={!draft.trim() || ask.isPending}
        >
          {ask.isPending ? 'thinking…' : 'Ask'}
        </button>
      </div>

      {ask.isError && (
        <div className="cx-answer">
          <div className="cx-axis-status" style={{ color: '#c33' }}>
            {(ask.error as Error).message.slice(0, 200)}
          </div>
        </div>
      )}

      {ask.data && lastQuestion && (
        <div className="cx-answer">
          <div className="cx-card-sub" style={{ marginBottom: 8 }}>
            <span className="cx-mono cx-muted">Q:</span> {lastQuestion}
          </div>
          <p style={{ fontSize: 18, lineHeight: 1.45, margin: '0 0 18px' }}>
            {ask.data.answer}
          </p>

          {ask.data.warning && (
            <div className="cx-card-sub cx-muted" style={{ marginBottom: 12 }}>
              ⚠ {ask.data.warning}
            </div>
          )}

          {ask.data.citations.length > 0 && (
            <div className="cx-citations">
              <div className="cx-axis-name" style={{ marginBottom: 8 }}>
                Citations
              </div>
              <ul className="cx-citation-list">
                {ask.data.citations.map((c, idx) => {
                  const key = `${c.itemId}-${idx}`
                  const open = expandedCitation === key
                  const label = c.finalFilename ?? '(unnamed)'
                  const location = c.finalPath ?? c.folderPath ?? '(unfiled)'
                  return (
                    <li key={key} className="cx-citation">
                      <button
                        className={'cx-citation-pill' + (open ? ' is-open' : '')}
                        onClick={() => setExpandedCitation(open ? null : key)}
                      >
                        <span className="cx-mono">{label}</span>
                        <span className="cx-mono cx-muted">{location}</span>
                        <span className="cx-mono cx-muted">d={c.distance.toFixed(3)}</span>
                      </button>
                      {open && (
                        <pre className="cx-citation-snippet">{c.snippet}</pre>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {ask.data.citations.length === 0 && (
            <div className="cx-card-sub cx-muted">
              No citations — answer was drawn from your archive&apos;s general state, or no relevant chunks were found.
            </div>
          )}
        </div>
      )}

      {!ask.data && !ask.isPending && !ask.isError && (
        <div className="cx-empty">
          <div className="cx-empty-title">Ask anything about your filed documents.</div>
          <div>Try <span className="cx-mono">what&apos;s my passport number?</span> or <span className="cx-mono">when does my residence permit expire?</span></div>
        </div>
      )}
    </div>
  )
}
