import { IdentityForm } from './IdentityForm'

export default function SettingsPage() {
  return (
    <div className="cx-tax">
      <div className="cx-tax-main">
        <div className="cx-topbar" style={{ gridColumn: 'unset', border: 0, padding: '0 0 18px' }}>
          <div>
            <div className="cx-topbar-eyebrow">Settings</div>
            <h1 className="cx-topbar-h1">Identities</h1>
            <div className="cx-topbar-sub">Names injected into classification prompts.</div>
          </div>
        </div>
        <IdentityForm />
      </div>
    </div>
  )
}
