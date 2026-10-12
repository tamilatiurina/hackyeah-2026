import { useState } from 'react'
import { useAuth } from '../../auth/context'
import type { OAuthProvider } from '../../auth/types'
import { buttonSecondary } from '../../ui/classes'

const PROVIDERS: ReadonlyArray<{ id: OAuthProvider; label: string }> = [
  { id: 'github', label: 'Continue with GitHub' },
  { id: 'google', label: 'Continue with Google' },
]

/** GitHub and Google sign-in. They leave for the provider and come back to /auth/callback. */
export function OAuthButtons() {
  const { signInWithOAuth } = useAuth()
  const [pending, setPending] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = async (provider: OAuthProvider) => {
    setPending(provider)
    setError(null)
    const message = await signInWithOAuth(provider)
    // On success the browser is already leaving; only a failure comes back here.
    if (message) {
      setError(message)
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {PROVIDERS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={buttonSecondary}
          disabled={pending !== null}
          onClick={() => void start(p.id)}
        >
          {pending === p.id ? 'Redirecting…' : p.label}
        </button>
      ))}
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or with email
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  )
}
