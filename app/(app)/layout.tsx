'use client'

import { ReactQueryProvider } from '@/lib/react-query'

// v1 shell: triage page is currently the only screen. Sidebar/MetricsStrip
// were removed during /plan-eng-review cleanup. The cx-app container still
// applies the existing design tokens from globals.css.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ReactQueryProvider>
      <div className="cx-app">
        <main className="cx-main">{children}</main>
      </div>
    </ReactQueryProvider>
  )
}
