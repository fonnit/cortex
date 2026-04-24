'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface RuleRow {
  id: string
  text: string
  fires: number
  lastFired: string | null
  provenance: string
  status: 'active' | 'dormant'
}

export default function RulesPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'dormant'>('all')
  const { data: rules = [] } = useQuery<RuleRow[]>({
    queryKey: ['rules'],
    queryFn: () => fetch('/api/rules').then(r => r.json()),
    refetchInterval: 30_000,
  })
  const filtered = rules.filter(r => filter === 'all' ? true : r.status === filter)

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
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
