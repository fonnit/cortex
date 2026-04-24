'use client'

import { useState } from 'react'

interface AskResponseParagraph {
  text: string
  cites: number[]
}

interface AskResponseSource {
  n: number
  title: string
  path: string
  when: string
}

interface AskResponse {
  answer: AskResponseParagraph[]
  sources: AskResponseSource[]
  latencyMs: number
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="cx-kbd">{children}</kbd>
}

export default function AskPage() {
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<AskResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!res.ok) throw new Error('Request failed')
      const data: AskResponse = await res.json()
      setResult(data)
      setHistory(prev => [question, ...prev.filter(h => h !== question)].slice(0, 8))
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleHistoryClick(q: string) {
    setQuestion(q)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      if (!res.ok) throw new Error('Request failed')
      const data: AskResponse = await res.json()
      setResult(data)
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cx-ask" data-screen-label="Ask">
      <div className="cx-ask-main">
        <form className="cx-ask-input" onSubmit={handleSubmit}>
          <span className="cx-ask-prompt">ask</span>
          <input
            className="cx-ask-field"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="ask anything — Cortex will cite its sources."
            disabled={loading}
          />
          <button className="cx-action cx-action-primary" type="submit" disabled={loading}>
            <span>{loading ? 'Answering…' : 'Answer'}</span>
            {!loading && <Kbd>↵</Kbd>}
          </button>
        </form>

        {error && <p className="cx-muted">{error}</p>}

        {result && (
          <div className="cx-answer">
            <div className="cx-answer-head">
              <span className="cx-answer-label">answer</span>
              <span className="cx-mono cx-muted">
                {`claude-haiku · ${result.sources.length} citations · ${result.latencyMs} ms`}
              </span>
            </div>
            <div className="cx-answer-body">
              {result.answer.map((p, i) => (
                <p key={i}>
                  {p.text}{' '}
                  {p.cites.map((n) => (
                    <a key={n} href={`#src-${n}`} className="cx-cite">
                      {n}
                    </a>
                  ))}
                </p>
              ))}
            </div>
            <div className="cx-answer-foot">
              <button className="cx-action cx-action-ghost" type="button" onClick={() => {}}>
                <span>Useful</span><Kbd>Y</Kbd>
              </button>
              <button className="cx-action cx-action-ghost" type="button" onClick={() => {}}>
                <span>Off</span><Kbd>N</Kbd>
              </button>
              <button className="cx-action cx-action-ghost" type="button" onClick={() => {}}>
                <span>Refine</span>
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="cx-sources">
            <div className="cx-sources-head">sources</div>
            <ol className="cx-sources-list">
              {result.sources.map((s) => (
                <li key={s.n} id={`src-${s.n}`} className="cx-source">
                  <span className="cx-source-n">{s.n}</span>
                  <div className="cx-source-body">
                    <div className="cx-source-title">{s.title}</div>
                    <div className="cx-source-path cx-mono">{s.path}</div>
                  </div>
                  <div className="cx-source-when cx-mono">{s.when}</div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <aside className="cx-ask-side">
        <div className="cx-ask-side-head">recent</div>
        <ul className="cx-ask-history">
          {history.map((h, i) => (
            <li key={i}>
              <button
                className="cx-ask-hist"
                type="button"
                onClick={() => handleHistoryClick(h)}
              >
                {h}
              </button>
            </li>
          ))}
        </ul>
        <div className="cx-ask-side-head cx-ask-side-head-2">this week</div>
        <div className="cx-ask-stats">
          <div className="cx-stat">
            <div className="cx-stat-v">{history.length}</div>
            <div className="cx-stat-k">cited answers</div>
          </div>
          <div className="cx-stat">
            <div className="cx-stat-v">—%</div>
            <div className="cx-stat-k">marked useful</div>
          </div>
        </div>
      </aside>
    </div>
  )
}
