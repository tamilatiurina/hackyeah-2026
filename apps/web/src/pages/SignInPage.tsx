import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { homeFor } from '../app/nav'
import { useMode } from '../app/mode'
import { useRole } from '../app/role'
import { useAuth } from '../auth/context'
import { buttonPrimary, inputClass } from '../ui/classes'

interface SignInState {
  from?: string
  notice?: string
}

const label = 'text-[13px] font-semibold text-[#30343B]'

export function SignInPage() {
  const { session, configured, notice: authNotice, signIn } = useAuth()
  const { role } = useRole()
  const navigate = useNavigate()
  const state = (useLocation().state ?? {}) as SignInState
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const { mode } = useMode()
  const target = state.from ?? homeFor(role, mode)
  const notice = state.notice ?? authNotice

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
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12 text-ink">
      <section
        aria-labelledby="sign-in-title"
        className="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-line bg-surface p-6"
      >
        <h1 id="sign-in-title" className="m-0 text-xl font-semibold">
          Sign in to Guardrail Hub
        </h1>
        {notice && <p className="m-0 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">{notice}</p>}
        {!configured ? (
          <p className="m-0 text-sm text-muted">
            {import.meta.env.DEV
              ? "Supabase isn't configured. Set SUPABASE_URL and SUPABASE_KEY in apps/web/.env.local (make supabase writes them)."
              : "Supabase isn't configured: this deployment was built without SUPABASE_URL and SUPABASE_KEY. Set them in the hosting project's environment variables and redeploy."}
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sign-in-email" className={label}>
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
              <label htmlFor="sign-in-password" className={label}>
                Password
              </label>
              <input
                id="sign-in-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && (
              <p role="alert" className="m-0 text-sm text-danger">
                {error}
              </p>
            )}
            <button type="submit" className={buttonPrimary} disabled={pending || !email.trim() || !password}>
              Sign in
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
