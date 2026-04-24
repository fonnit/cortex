'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

interface RuleRow {
  id: string
  text: string
  fires: number
  lastFired: string | null
  provenance: string
  status: 'active' | 'dormant'
}

interface PreviewState {
  old: string
  new: string
  conflicts: Array<{ id: string; text: string; similarity: number }>
}

export default function RulesPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'dormant'>('all')
  const [editRule, setEditRule] = useState<RuleRow | null>(null)
  const [editText, setEditText] = useState('')
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const queryClient = useQueryClient()

  const { data: rules = [] } = useQuery<RuleRow[]>({
    queryKey: ['rules'],
    queryFn: () => fetch('/api/rules').then(r => r.json()),
    refetchInterval: 30_000,
  })
  const filtered = rules.filter(r => filter === 'all' ? true : r.status === filter)

  async function fetchPreview(id: string, text: string) {
    const res = await fetch(`/api/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const data = await res.json()
    setPreview(data)
  }

  async function confirmEdit(id: string, text: string) {
    setEditBusy(true)
    try {
      await fetch(`/api/rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, confirm: true }),
      })
      await queryClient.invalidateQueries({ queryKey: ['rules'] })
      setEditRule(null)
      setPreview(null)
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <div className="cx-rules" data-screen-label="Rules">
      <div className="cx-rules-head">
        <div className="cx-tabrow">
          {(['all', 'active', 'dormant'] as const).map(f => (
            <button
              key={f}
              className={'cx-tab ' + (filter === f ? 'is-active' : '')}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="cx-tab-count">
                {f === 'all' ? rules.length : rules.filter(r => r.status === f).length}
              </span>
            </button>
          ))}
        </div>
        <div className="cx-rules-note cx-muted">
          hard cap: 20 rules / classification prompt · weekly consolidation job active
        </div>
      </div>
      <ol className="cx-rules-list">
        {filtered.map(r => (
          <li key={r.id} className={'cx-rule cx-rule-' + r.status}>
            <div className="cx-rule-head">
              <span className="cx-mono cx-muted">{r.id}</span>
              <span className={'cx-rule-status cx-rule-status-' + r.status}>{r.status}</span>
            </div>
            <code className="cx-rule-text">{r.text}</code>
            <div className="cx-rule-foot cx-mono cx-muted">
              <span>{r.fires} fires</span>
              <span>last {r.lastFired ? new Date(r.lastFired).toLocaleDateString() : 'never'}</span>
              <span>{r.provenance}</span>
              <button className="cx-linkbtn" onClick={() => { setEditRule(r); setEditText(r.text); setPreview(null) }}>edit</button>
            </div>
          </li>
        ))}
      </ol>
      {editRule && (
        <div className="cx-edit-panel" style={{ marginTop: 24, padding: '20px 24px', border: '1px solid var(--cx-rule)', borderRadius: 8, background: 'var(--cx-panel)' }}>
          <div style={{ fontFamily: 'var(--cx-ff-serif)', fontSize: 16, fontWeight: 500, marginBottom: 12 }}>
            Edit rule <span className="cx-mono cx-muted">{editRule.id}</span>
          </div>
          <textarea
            className="cx-input"
            style={{ minHeight: 80, resize: 'vertical', fontFamily: 'var(--cx-ff-mono)', fontSize: 12.5 }}
            value={editText}
            onChange={e => { setEditText(e.target.value); setPreview(null) }}
          />
          {preview && (
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--cx-ink-80)' }}>
              <div className="cx-mono cx-muted" style={{ marginBottom: 4 }}>diff preview</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <code className="cx-rule-text" style={{ opacity: 0.6, textDecoration: 'line-through' }}>{preview.old}</code>
                <code className="cx-rule-text">{preview.new}</code>
              </div>
              {preview.conflicts.length > 0 && (
                <div style={{ marginTop: 8, color: 'var(--cx-warn)' }}>
                  Conflicts with: {preview.conflicts.map(c => c.id).join(', ')} ({(preview.conflicts[0].similarity * 100).toFixed(0)}% similar)
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {!preview ? (
              <button className="cx-action" onClick={() => fetchPreview(editRule.id, editText)}><span>Preview diff</span></button>
            ) : (
              <button className="cx-action cx-action-primary" disabled={editBusy} onClick={() => confirmEdit(editRule.id, editText)}><span>Confirm edit</span></button>
            )}
            <button className="cx-action cx-action-ghost" onClick={() => { setEditRule(null); setPreview(null) }}><span>Cancel</span></button>
          </div>
        </div>
      )}
    </div>
  )
}
