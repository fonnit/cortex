import { IdentityForm } from './IdentityForm'

export default function SettingsPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <h2 className="text-sm opacity-60 mt-0.5">Identity profiles</h2>
        <p className="text-sm opacity-50 mt-1">
          Names and relationships used to personalise document classification.
        </p>
      </div>
      <IdentityForm />
    </div>
  )
}
