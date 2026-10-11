import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { DEFAULT_HOME } from '../../app/nav'
import { useAuth } from '../../auth/context'
import { buttonPrimary, inputClass } from '../../ui/classes'
import { AuthLink, AuthShell, FormError, fieldLabel } from './AuthShell'
import { OAuthButtons } from './OAuthButtons'

interface SignInState {
  from?: string
  notice?: string
}

export function SignInPage() {
  const { session, notice: authNotice, signIn } = useAuth()
  const navigate = useNavigate()
  const state = (useLocation().state ?? {}) as SignInState
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const target = state.from ?? DEFAULT_HOME

  if (session) return <Navigate to={target} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const message = await signIn(email.trim(), password)
    setPending(false)
    if (message) setError(message)
    else navigate(target, { replace: true })
  }

  return (
    <AuthShell
      title="Sign in to AgentsOnRails.dev"
      notice={state.notice ?? authNotice}
      footer={
        <>
          No account yet? <AuthLink to="/sign-up">Create one</AuthLink>
        </>
      }
    >
      <OAuthButtons />
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-in-email" className={fieldLabel}>
            Email
          </label>
          <input
            id="sign-in-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="sign-in-password" className={fieldLabel}>
              Password
            </label>
            <AuthLink to="/forgot-password">Forgot password?</AuthLink>
          </div>
          <input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <FormError message={error} />
        <button type="submit" className={buttonPrimary} disabled={pending || !email.trim() || !password}>
          Sign in
        </button>
      </form>
    </AuthShell>
  )
}
