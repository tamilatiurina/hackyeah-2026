import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/context'
import { buttonPrimary, inputClass } from '../../ui/classes'
import { AuthLink, AuthShell, FormError, fieldLabel } from './AuthShell'

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const address = email.trim()
    const message = await sendPasswordReset(address)
    setPending(false)
    if (message) setError(message)
    else setSentTo(address)
  }

  const footer = <AuthLink to="/sign-in">Back to sign in</AuthLink>

  if (sentTo) {
    return (
      <AuthShell title="Check your email" footer={footer}>
        <p className="m-0 text-sm">
          If <span className="font-semibold">{sentTo}</span> has an account, a link to set a new password is on its
          way.
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Reset your password" footer={footer}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="forgot-email" className={fieldLabel}>
            Email
          </label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <FormError message={error} />
        <button type="submit" className={buttonPrimary} disabled={pending || !email.trim()}>
          Send reset link
        </button>
      </form>
    </AuthShell>
  )
}
