import { Navigate, useLocation } from 'react-router'
import { DEFAULT_HOME } from '../../app/nav'
import { useAuth } from '../../auth/context'
import { AuthLink, AuthShell } from './AuthShell'

/** Where GitHub, Google and the sign-up confirmation email send the browser back to. Supabase reads
 * the ?code= while the session loads; this page waits, then goes to the app. */
export function AuthCallbackPage() {
  const { status, session } = useAuth()
  const params = new URLSearchParams(useLocation().search)
  const failure = params.get('error_description') ?? params.get('error')

  if (session) return <Navigate to={DEFAULT_HOME} replace />
  if (status === 'loading' && !failure) return null

  return (
    <AuthShell title="Couldn't sign you in" footer={<AuthLink to="/sign-in">Back to sign in</AuthLink>}>
      <p className="m-0 text-sm">{failure ?? 'This sign-in link has expired or was already used. Try again.'}</p>
    </AuthShell>
  )
}
