import { createClient, type Session } from '@supabase/supabase-js'
import type { AuthClient, AuthSession } from './types'

function toSession(session: Session | null): AuthSession | null {
  return session ? { accessToken: session.access_token, email: session.user.email ?? '' } : null
}

/** Null when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. */
export function createAuthClient(): AuthClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const { auth } = createClient(url, key)
  return {
    async getSession() {
      const { data } = await auth.getSession()
      return toSession(data.session)
    },
    onAuthStateChange(callback) {
      const { data } = auth.onAuthStateChange((_event, session) => callback(toSession(session)))
      return () => data.subscription.unsubscribe()
    },
    async signIn(email, password) {
      const { error } = await auth.signInWithPassword({ email, password })
      return error ? error.message : null
    },
    async signOut() {
      await auth.signOut()
    },
  }
}
