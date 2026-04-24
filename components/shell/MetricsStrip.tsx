'use client'

import { useQuery } from '@tanstack/react-query'

interface MetricsResponse {
  weekly: { citedAnswers: number | null; medianDecisionSec: number | null }
  auto: {
    relevanceAutoPct: number | null
    labelAutoPct: number | null
    rules: number
    dormantRatio: number | null
  }
  queues: { relevance: number; label: number }
}

export function MetricsStrip() {
  const { data: metrics } = useQuery<MetricsResponse>({
    queryKey: ['metrics'],
    queryFn: () => fetch('/api/metrics').then((r) => r.json()),
    refetchInterval: 30_000,
  })

  const cells = [
    {
      k: 'cited answers / wk',
      v: metrics?.weekly.citedAnswers ?? '—',
      sub: 'target ≥ 20',
    },
    {
      k: 'relevance auto',
      v: metrics?.auto.relevanceAutoPct != null ? metrics.auto.relevanceAutoPct + '%' : '—',
      sub: 'target ≥ 50%',
    },
    {
      k: 'label auto-archive',
      v: metrics?.auto.labelAutoPct != null ? metrics.auto.labelAutoPct + '%' : '—',
      sub: 'target ≥ 60%',
    },
    {
      k: 'median decision',
      v: metrics?.weekly.medianDecisionSec != null ? metrics.weekly.medianDecisionSec + 's' : '—',
      sub: 'target < 3s',
    },
    {
      k: 'rules',
      v: metrics?.auto.rules ?? '—',
      sub: 'median 9 in ctx',
    },
    {
      k: 'dormant',
      v: metrics?.auto.dormantRatio != null
        ? Math.round(metrics.auto.dormantRatio * 100) + '%'
        : '—',
      sub: 'of rule base',
    },
  ]

  return (
    <div className="cx-strip">
      {cells.map((c) => (
        <div className="cx-strip-cell" key={c.k}>
          <div className="cx-strip-v">{c.v}</div>
          <div className="cx-strip-k">{c.k}</div>
          <div className="cx-strip-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}
