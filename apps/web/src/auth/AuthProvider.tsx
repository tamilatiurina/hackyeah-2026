import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { setAccessTokenProvider, setUnauthorizedHandler } from '../api/client'
import { AuthContext, SESSION_EXPIRED, type AuthState } from './context'
import type { AuthClient, AuthSession } from './types'

interface AuthProviderProps {
  client: AuthClient | null
  /** Skips the async session lookup (tests). */
  initialSession?: AuthSession | null
  /** Without a session, start a Supabase anonymous (guest) session instead of asking to sign in. */
  guest?: boolean
  children: ReactNode
}

export function AuthProvider({ client, initialSession, guest = false, children }: AuthProviderProps) {
  const queryClient = useQueryClient()
  const [session, setSessionState] = useState<AuthSession | null>(initialSession ?? null)
  const [notice, setNotice] = useState<string | null>(null)
  const [guestError, setGuestError] = useState<string | null>(null)
  const guestPending = useRef(false)
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
      if (!next || (previous && previous.email !== next.email)) queryClient.clear()
      setSession(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [client, initialSession, queryClient, setSession])

  // Guest mode: whenever there is no session (first visit, expired guest), start a new guest session.
  useEffect(() => {
    if (!guest || !client || status !== 'ready' || session || guestError || guestPending.current) return
    guestPending.current = true
    setStatus('loading') // RequireAuth shows nothing meanwhile, so the sign-in page never flashes
    void client.signInAnonymously().then(async (error) => {
      if (error) setGuestError(error)
      else setSession(await client.getSession())
      guestPending.current = false
      setStatus('ready')
    })
  }, [guest, client, status, session, guestError, setSession])

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
      if (!client) return 'Supabase is not configured'
      const error = await client.signIn(email, password)
      if (!error) {
        setNotice(null)
        setSession(await client.getSession())
      }
      return error
    },
    [client, setSession],
  )

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      configured: client !== null,
      notice: notice ?? (guestError ? `Couldn't start a guest session: ${guestError}` : null),
      signIn,
      signOut,
    }),
    [status, session, client, notice, guestError, signIn, signOut],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
