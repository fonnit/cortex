'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ReactQueryProvider } from '@/lib/react-query'
import { Sidebar } from '@/components/shell/Sidebar'
import { MetricsStrip } from '@/components/shell/MetricsStrip'

interface MetricsResponse {
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

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  // Derive active nav item from pathname
  const route = pathname.split('/')[1] ?? 'triage'

  const { data: metrics } = useQuery<MetricsResponse>({
    queryKey: ['metrics'],
    queryFn: () => fetch('/api/metrics').then((r) => r.json()),
    staleTime: 10_000,
    refetchInterval: 10_000,
  })

  const queues = metrics?.queues ?? { relevance: 0, label: 0 }

  function onRouteChange(r: string) {
    router.push(`/${r}`)
  }

  return (
    <div className="cx-app">
      <Sidebar route={route} onRouteChange={onRouteChange} queues={queues} />
      <MetricsStrip />
      <main className="cx-main">{children}</main>
    </div>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ReactQueryProvider>
      <AppShell>{children}</AppShell>
    </ReactQueryProvider>
  )
}
