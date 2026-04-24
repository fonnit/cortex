'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ReactQueryProvider } from '@/lib/react-query'
import { Sidebar } from '@/components/shell/Sidebar'

interface MetricsResponse {
  weekly: { citedAnswers: number | null; medianDecisionSec: number | null }
  auto: { relevanceAutoPct: number | null; labelAutoPct: number | null; rules: number; dormantRatio: number | null }
  queues: { relevance: number; label: number }
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
