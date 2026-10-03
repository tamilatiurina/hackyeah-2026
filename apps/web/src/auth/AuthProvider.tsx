import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { setAccessTokenProvider, setUnauthorizedHandler } from '../api/client'
import { AuthContext, SESSION_EXPIRED, type AuthState } from './context'
import type { AuthClient, AuthSession } from './types'

interface AuthProviderProps {
  client: AuthClient | null
  /** Skips the async session lookup (tests). */
  initialSession?: AuthSession | null
  children: ReactNode
}

export function AuthProvider({ client, initialSession, children }: AuthProviderProps) {
  const queryClient = useQueryClient()
  const [session, setSessionState] = useState<AuthSession | null>(initialSession ?? null)
  const [notice, setNotice] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>(
    !client || initialSession !== undefined ? 'ready' : 'loading',
  )
  // Read at request time; updated before state so a child's first request already has the token.
  const sessionRef = useRef<AuthSession | null>(initialSession ?? null)

  const setSession = useCallback((next: AuthSession | null) => {
    sessionRef.current = next
    setSessionState(next)
  }, [])

  useEffect(() => {
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
    const unsubscribe = client.onAuthStateChange(setSession)
    return () => {
      active = false
      unsubscribe()
    }
  }, [client, initialSession, setSession])

  const signOut = useCallback(async () => {
    setSession(null)
    queryClient.clear()
    await client?.signOut()
  }, [client, queryClient, setSession])

  useEffect(() => {
    // RequireAuth does the redirect; navigating here as well would race it and lose the notice.
    setUnauthorizedHandler(() => {
      if (!sessionRef.current) return // already signed out: no loop
      setNotice(SESSION_EXPIRED)
      void signOut()
    })
    return () => setUnauthorizedHandler(null)
  }, [signOut])

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
    () => ({ status, session, configured: client !== null, notice, signIn, signOut }),
    [status, session, client, notice, signIn, signOut],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
