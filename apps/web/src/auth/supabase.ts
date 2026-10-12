import { createClient, type Session } from '@supabase/supabase-js'
import type { AuthClient, AuthSession } from './types'

function toSession(session: Session | null): AuthSession | null {
  return session
    ? {
        accessToken: session.access_token,
        userId: session.user.id,
        email: session.user.email ?? '',
      }
    : null
}

/** Where Supabase sends the browser back to after OAuth and email links (same origin). */
const redirectTo = (path: string) => `${window.location.origin}${path}`

/** Null when SUPABASE_URL / SUPABASE_KEY were not set at build time. */
export function createAuthClient(): AuthClient | null {
  const url = import.meta.env.SUPABASE_URL
  const key = import.meta.env.SUPABASE_KEY
  if (!url || !key) return null
  // PKCE: OAuth and email links come back with a ?code= that the client exchanges on load.
  const supabase = createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true } })
  const { auth } = supabase
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
    async signUp(email, password) {
      const { data, error } = await auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo('/auth/callback') },
      })
      // With email confirmation on, Supabase creates the user but starts no session yet.
      return { error: error ? error.message : null, confirmEmail: !error && !data.session }
    },
    async signInWithOAuth(provider) {
      const { error } = await auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectTo('/auth/callback') },
      })
      return error ? error.message : null
    },
    async sendPasswordReset(email) {
      const { error } = await auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo('/reset-password'),
      })
      return error ? error.message : null
    },
    async updatePassword(password) {
      const { error } = await auth.updateUser({ password })
      return error ? error.message : null
    },
    watchTables(tables, onChange, onStatus) {
      // The client sends the signed-in user's token to Realtime, so RLS limits what is heard.
      const channel = supabase.channel(`live-${tables.join('-')}-${Math.random().toString(36).slice(2)}`)
      for (const table of tables) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange())
      }
      channel.subscribe((status) => onStatus(status === 'SUBSCRIBED'))
      return () => {
        onStatus(false)
        void supabase.removeChannel(channel)
      }
    },
    async signOut() {
      // Local: only this browser. A global sign-out would also revoke other devices' sessions.
      await auth.signOut({ scope: 'local' })
    },
  }
}
