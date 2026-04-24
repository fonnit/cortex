import { Topbar } from '@/components/shell/Topbar'
import { TriageView } from '@/components/triage/TriageView'

export default function TriagePage() {
  return (
    <>
      <Topbar
        title="Triage"
        subtitle="Single card at a time. Keyboard-first. Compounding rules, not growing backlog."
      />
      <TriageView />
    </>
  )
}
