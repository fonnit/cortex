import Link from 'next/link'
import { TriageView } from '@/components/triage/TriageView'

export default function TriagePage() {
  return (
    <div>
      <header className="cx-topbar">
        <div>
          <div className="cx-topbar-eyebrow">Cortex / Triage</div>
          <div className="cx-topbar-sub">One card at a time. Press 1-5 to approve a proposal.</div>
        </div>
        <div className="cx-topbar-right">
          <Link className="cx-action cx-action-ghost" href="/ask">Ask →</Link>
        </div>
      </header>
      <TriageView />
    </div>
  )
}
