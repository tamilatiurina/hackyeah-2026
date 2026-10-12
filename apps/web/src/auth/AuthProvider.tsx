import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { setAccessTokenProvider, setUnauthorizedHandler } from '../api/client'
import { bootstrapAccount } from '../api/me'
import { AuthContext, SESSION_EXPIRED, type AuthState } from './context'
import type { AuthClient, AuthSession, OAuthProvider } from './types'

interface AuthProviderProps {
  client: AuthClient | null
  /** Skips the async session lookup (tests). */
  initialSession?: AuthSession | null
  children: ReactNode
}

const NOT_CONFIGURED = 'Supabase is not configured'

export function AuthProvider({ client, initialSession, children }: AuthProviderProps) {
  const queryClient = useQueryClient()
  const [session, setSessionState] = useState<AuthSession | null>(initialSession ?? null)
  const [notice, setNotice] = useState<string | null>(null)
  // Users whose first-sign-in setup already ran in this tab.
  const bootstrapped = useRef(new Set<string>())
  const [status, setStatus] = useState<'loading' | 'ready'>(
    !client || initialSession !== undefined ? 'ready' : 'loading',
  )
  // Read at request time; updated before state so a child's first request already has the token.
  const sessionRef = useRef<AuthSession | null>(initialSession ?? null)

  const setSession = useCallback((next: AuthSession | null) => {
    sessionRef.current = next
    setSessionState(next)
  }, [])

  // Layout effects run before any child's passive effects, so the first query already has these.
  useLayoutEffect(() => {
    setAccessTokenProvider(() => sessionRef.current?.accessToken ?? null)
  }, [])

  useEffect(() => {
    if (!client) return
    let active = true
    if (initialSession === undefined) {
      void client.getSession().then((s) => {
        if (!active) return
        setSession(s)
        setStatus('ready')
      })
    }
    const unsubscribe = client.onAuthStateChange((next) => {
      // Signed out elsewhere (another tab, failed refresh) or a different user: drop their data.
      const previous = sessionRef.current
      if (!next || (previous && previous.userId !== next.userId)) queryClient.clear()
      setSession(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [client, initialSession, queryClient, setSession])

  // First sign-in setup (seed library, demo agent): once per user per tab; the API does each step
  // only once per account. When it added anything, refetch so the new rows show up.
  const userId = session?.userId
  useEffect(() => {
    if (!client || !userId || bootstrapped.current.has(userId)) return
    bootstrapped.current.add(userId)
    bootstrapAccount()
      .then((result) => {
        if (result.library === 'seeded' || result.demo_agent === 'added') void queryClient.invalidateQueries()
      })
      .catch(() => bootstrapped.current.delete(userId)) // retried at the next sign-in or reload
  }, [client, userId, queryClient])

  const signOut = useCallback(async () => {
    setSession(null)
    queryClient.clear()
    await client?.signOut()
  }, [client, queryClient, setSession])

  useLayoutEffect(() => {
    // RequireAuth does the redirect; navigating here as well would race it and lose the notice.
    setUnauthorizedHandler(async (canRetry) => {
      if (!sessionRef.current) return false // already signed out: no loop
      if (canRetry && client) {
        // Usually just an expired access token (e.g. after sleep): refresh and let the client retry.
        const refreshed = await client.refreshSession()
        if (refreshed) {
          setSession(refreshed)
          return true
        }
      }
      setNotice(SESSION_EXPIRED)
      await signOut()
      return false
    })
    return () => setUnauthorizedHandler(null)
  }, [client, setSession, signOut])

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!client) return NOT_CONFIGURED
      const error = await client.signIn(email, password)
      if (!error) {
        setNotice(null)
        setSession(await client.getSession())
      }
      return error
    },
    [client, setSession],
  )

  const signUp = useCallback(
    async (email: string, password: string) => {
      if (!client) return { error: NOT_CONFIGURED, confirmEmail: false }
      const result = await client.signUp(email, password)
      if (!result.error && !result.confirmEmail) {
        setNotice(null)
        setSession(await client.getSession())
      }
      return result
    },
    [client, setSession],
  )

  const signInWithOAuth = useCallback(
    async (provider: OAuthProvider) => (client ? client.signInWithOAuth(provider) : NOT_CONFIGURED),
    [client],
  )

  const sendPasswordReset = useCallback(
    async (email: string) => (client ? client.sendPasswordReset(email) : NOT_CONFIGURED),
    [client],
  )

  const updatePassword = useCallback(
    async (password: string) => (client ? client.updatePassword(password) : NOT_CONFIGURED),
    [client],
  )

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      configured: client !== null,
      notice,
      signIn,
      signUp,
      signInWithOAuth,
      sendPasswordReset,
      updatePassword,
      signOut,
      watchTables: client?.watchTables ?? null,
    }),
    [status, session, client, notice, signIn, signUp, signInWithOAuth, sendPasswordReset, updatePassword, signOut],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
