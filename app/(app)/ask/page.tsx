import Link from 'next/link'
import { AskView } from '@/components/ask/AskView'

export default function AskPage() {
  return (
    <div>
      <header className="cx-topbar">
        <div>
          <div className="cx-topbar-eyebrow">Cortex / Ask</div>
          <div className="cx-topbar-sub">Natural-language Q&A over your filed archive.</div>
        </div>
        <div className="cx-topbar-right">
          <Link className="cx-action cx-action-ghost" href="/triage">Triage →</Link>
        </div>
      </header>
      <AskView />
    </div>
  )
}
