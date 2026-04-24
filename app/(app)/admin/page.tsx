'use client'

import { useQuery } from '@tanstack/react-query'

interface MetricsData {
  queues: { relevance: number; label: number }
  weekly: { citedAnswers: number | null; medianDecisionSec: number | null }
  auto: {
    relevanceAutoPct: number | null
    labelAutoPct: number | null
    rules: number
    medianRulesInCtx: number | null
    dormantRatio: number | null
  }
  queueTrend: number[]
  weeklyPulse: number | null
}

function Sparkline({ values, w = 120, h = 28 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="cx-spark" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

export default function AdminPage() {
  const { data: m } = useQuery<MetricsData>({
    queryKey: ['metrics'],
    queryFn: () => fetch('/api/metrics').then(r => r.json()),
    refetchInterval: 30_000,
    placeholderData: {
      queues: { relevance: 0, label: 0 },
      weekly: { citedAnswers: null, medianDecisionSec: null },
      auto: {
        relevanceAutoPct: null,
        labelAutoPct: null,
        rules: 0,
        medianRulesInCtx: null,
        dormantRatio: null,
      },
      queueTrend: [],
      weeklyPulse: null,
    },
  })

  if (!m) return null

  const rows = [
    {
      k: 'Relevance auto-decision',
      v: m.auto.relevanceAutoPct != null ? `${m.auto.relevanceAutoPct.toFixed(0)}%` : '—',
      target: '≥ 50%',
      pass: (m.auto.relevanceAutoPct ?? 0) >= 50,
    },
    {
      k: 'Label auto-archive',
      v: m.auto.labelAutoPct != null ? `${m.auto.labelAutoPct.toFixed(0)}%` : '—',
      target: '≥ 60%',
      pass: (m.auto.labelAutoPct ?? 0) >= 60,
    },
    {
      k: 'Median triage decision',
      v: m.weekly.medianDecisionSec != null ? `${m.weekly.medianDecisionSec} s` : '—',
      target: '< 3 s',
      pass: m.weekly.medianDecisionSec == null ? false : m.weekly.medianDecisionSec < 3,
    },
    {
      k: 'Cited answers / wk',
      v: m.weekly.citedAnswers != null ? String(m.weekly.citedAnswers) : '—',
      target: '≥ 20',
      pass: (m.weekly.citedAnswers ?? 0) >= 20,
    },
    {
      k: 'Rule count',
      v: String(m.auto.rules),
      target: '—',
      pass: true,
    },
    {
      k: 'Dormant rule ratio',
      v: m.auto.dormantRatio != null ? `${Math.round(m.auto.dormantRatio * 100)}%` : '—',
      target: '< 30%',
      pass: (m.auto.dormantRatio ?? 0) < 0.3,
    },
    {
      k: 'Median rules in context',
      v: m.auto.medianRulesInCtx != null ? String(m.auto.medianRulesInCtx) : '—',
      target: '≤ 20',
      pass: (m.auto.medianRulesInCtx ?? 0) <= 20,
    },
  ]

  return (
    <div className="cx-admin" data-screen-label="Admin">
      <div className="cx-admin-top">
        <div className="cx-admin-card">
          <div className="cx-admin-card-head">queue depths</div>
          <div className="cx-admin-card-body">
            <div className="cx-qdepth">
              <div className="cx-qdepth-n">{m.queues.relevance}</div>
              <div className="cx-qdepth-k">relevance</div>
            </div>
            <div className="cx-qdepth">
              <div className="cx-qdepth-n">{m.queues.label}</div>
              <div className="cx-qdepth-k">label</div>
            </div>
            {m.queueTrend.length >= 2 && (
              <div className="cx-qdepth cx-qdepth-trend">
                <Sparkline values={m.queueTrend} w={140} h={36} />
                <div className="cx-qdepth-k">8-day trend</div>
              </div>
            )}
          </div>
        </div>
        <div className="cx-admin-card">
          <div className="cx-admin-card-head">rule system health</div>
          <div className="cx-admin-card-body cx-admin-card-body-text">
            <div className="cx-kv">
              <span>rule count</span>
              <b>{m.auto.rules}</b>
            </div>
            <div className="cx-kv">
              <span>median rules in context</span>
              <b>{m.auto.medianRulesInCtx ?? '—'}</b>
            </div>
            <div className="cx-kv">
              <span>dormant ratio</span>
              <b>{m.auto.dormantRatio != null ? `${Math.round(m.auto.dormantRatio * 100)}%` : '—'}</b>
            </div>
            <div className="cx-kv">
              <span>next consolidation</span>
              <b>Sun 04:00</b>
            </div>
          </div>
        </div>
        <div className="cx-admin-card">
          <div className="cx-admin-card-head">pulse</div>
          <div className="cx-admin-card-body cx-admin-card-body-text">
            <div className="cx-pulse">
              <div className="cx-pulse-n">
                {m.weeklyPulse ?? '—'}
                {m.weeklyPulse != null && <span className="cx-pulse-of"> / 10</span>}
              </div>
              <div className="cx-pulse-q">&ldquo;Is Cortex working for you?&rdquo;</div>
            </div>
          </div>
        </div>
      </div>
      <table className="cx-table cx-admin-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="cx-right">Value</th>
            <th className="cx-right">Target</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.k}>
              <td>{r.k}</td>
              <td className="cx-right cx-mono">{r.v}</td>
              <td className="cx-right cx-mono cx-muted">{r.target}</td>
              <td>
                <span className={'cx-admin-dot ' + (r.pass ? 'is-pass' : 'is-fail')} />
                <span className="cx-mono">{r.pass ? 'on track' : 'off'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
