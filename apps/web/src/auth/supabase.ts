import { createClient, type Session } from '@supabase/supabase-js'
import type { AuthClient, AuthSession } from './types'

function toSession(session: Session | null): AuthSession | null {
  return session
    ? {
        accessToken: session.access_token,
        email: session.user.email ?? '',
        anonymous: session.user.is_anonymous ?? false,
      }
    : null
}

/** Null when SUPABASE_URL / SUPABASE_KEY were not set at build time. */
export function createAuthClient(): AuthClient | null {
  const url = import.meta.env.SUPABASE_URL
  const key = import.meta.env.SUPABASE_KEY
  if (!url || !key) return null
  const { auth } = createClient(url, key)
  return {
    async getSession() {
      const { data } = await auth.getSession()
      return toSession(data.session)
    },
    async refreshSession() {
      const { data, error } = await auth.refreshSession()
      return error ? null : toSession(data.session)
    },
    onAuthStateChange(callback) {
      const { data } = auth.onAuthStateChange((_event, session) => callback(toSession(session)))
      return () => data.subscription.unsubscribe()
    },
    async signIn(email, password) {
      const { error } = await auth.signInWithPassword({ email, password })
      return error ? error.message : null
    },
    async signInAnonymously() {
      const { error } = await auth.signInAnonymously()
      return error ? error.message : null
    },
    async signOut() {
      // Local: only this browser. A global sign-out would also revoke other devices' sessions.
      await auth.signOut({ scope: 'local' })
    },
  }
}
