import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { DEFAULT_HOME } from '../../app/nav'
import { useAuth } from '../../auth/context'
import { buttonPrimary, inputClass } from '../../ui/classes'
import { AuthLink, AuthShell, FormError, fieldLabel } from './AuthShell'
import { OAuthButtons } from './OAuthButtons'

export const MIN_PASSWORD_LENGTH = 8

export function SignUpPage() {
  const { session, signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (session) return <Navigate to={DEFAULT_HOME} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const address = email.trim()
    const result = await signUp(address, password)
    setPending(false)
    if (result.error) setError(result.error)
    else if (result.confirmEmail) setSentTo(address)
    // Otherwise the session arrives and the redirect above takes over.
  }

  const footer = (
    <>
      Already have an account? <AuthLink to="/sign-in">Sign in</AuthLink>
    </>
  )

  if (sentTo) {
    return (
      <AuthShell title="Check your email" footer={footer}>
        <p className="m-0 text-sm">
          We sent a confirmation link to <span className="font-semibold">{sentTo}</span>. Open it to finish
          creating your account.
        </p>
      </AuthShell>
    )
  }

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  return (
    <AuthShell title="Create your account" footer={footer}>
      <OAuthButtons />
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-up-email" className={fieldLabel}>
            Email
          </label>
          <input
            id="sign-up-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-up-password" className={fieldLabel}>
            Password
          </label>
          <input
            id="sign-up-password"
            type="password"
            autoComplete="new-password"
            value={password}
            aria-describedby="sign-up-password-hint"
            aria-invalid={tooShort}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <span id="sign-up-password-hint" className="text-xs text-muted">
            At least {MIN_PASSWORD_LENGTH} characters.
          </span>
        </div>
        <FormError message={error} />
        <button
          type="submit"
          className={buttonPrimary}
          disabled={pending || !email.trim() || password.length < MIN_PASSWORD_LENGTH}
        >
          Create account
        </button>
      </form>
    </AuthShell>
  )
}
