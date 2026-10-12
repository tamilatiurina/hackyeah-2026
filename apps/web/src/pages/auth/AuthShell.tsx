import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/context'

export const fieldLabel = 'text-[13px] font-semibold text-[#30343B]'

interface AuthShellProps {
  title: string
  /** Shown above the form, e.g. why the user was signed out. */
  notice?: string | null
  /** Links under the card ("No account? Create one"). */
  footer?: ReactNode
  children: ReactNode
}

/** The centered card every signed-out page uses (sign in, sign up, password reset). */
export function AuthShell({ title, notice, footer, children }: AuthShellProps) {
  const { configured } = useAuth()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-4 py-12 text-ink">
      <section
        aria-labelledby="auth-title"
        className="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-line bg-surface p-6"
      >
        <h1 id="auth-title" className="m-0 text-xl font-semibold">
          {title}
        </h1>
        {notice && <p className="m-0 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">{notice}</p>}
        {configured ? (
          children
        ) : (
          <p className="m-0 text-sm text-muted">
            {import.meta.env.DEV
              ? "Supabase isn't configured. Set SUPABASE_URL and SUPABASE_KEY in apps/web/.env.local (make supabase writes them)."
              : "Supabase isn't configured: this deployment was built without SUPABASE_URL and SUPABASE_KEY. Set them in the hosting project's environment variables and redeploy."}
          </p>
        )}
      </section>
      {configured && footer && <p className="m-0 text-sm text-muted">{footer}</p>}
    </main>
  )
}

export function AuthLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-semibold text-teal-dark">
      {children}
    </Link>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="m-0 text-sm text-danger">
      {message}
    </p>
  )
}
