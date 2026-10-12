import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { DEFAULT_HOME } from '../../app/nav'
import { useAuth } from '../../auth/context'
import { buttonPrimary, inputClass } from '../../ui/classes'
import { AuthLink, AuthShell, FormError, fieldLabel } from './AuthShell'
import { MIN_PASSWORD_LENGTH } from './SignUpPage'

/** Where the password reset email lands: the link signs the user in, then they pick a password. */
export function ResetPasswordPage() {
  const { status, session, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (status === 'loading') return null
  if (!session) {
    return (
      <AuthShell title="Reset link expired" footer={<AuthLink to="/sign-in">Back to sign in</AuthLink>}>
        <p className="m-0 text-sm">
          This link has expired or was already used. <AuthLink to="/forgot-password">Send a new one</AuthLink>.
        </p>
      </AuthShell>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const message = await updatePassword(password)
    setPending(false)
    if (message) setError(message)
    else navigate(DEFAULT_HOME, { replace: true })
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">For {session.email}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className={fieldLabel}>
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            aria-describedby="new-password-hint"
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <span id="new-password-hint" className="text-xs text-muted">
            At least {MIN_PASSWORD_LENGTH} characters.
          </span>
        </div>
        <FormError message={error} />
        <button type="submit" className={buttonPrimary} disabled={pending || password.length < MIN_PASSWORD_LENGTH}>
          Save password
        </button>
      </form>
    </AuthShell>
  )
}
