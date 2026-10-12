import { createContext, useContext } from 'react'
import type { AuthClient, AuthSession, OAuthProvider, SignUpResult } from './types'

export const SESSION_EXPIRED = 'Your session expired. Sign in again.'

export interface AuthState {
  status: 'loading' | 'ready'
  session: AuthSession | null
  configured: boolean
  /** Why the user was signed out, shown on the sign-in page (e.g. SESSION_EXPIRED). */
  notice: string | null
  signIn(email: string, password: string): Promise<string | null>
  /** Signs the new user in, unless Supabase first wants the email confirmed (confirmEmail). */
  signUp(email: string, password: string): Promise<SignUpResult>
  signInWithOAuth(provider: OAuthProvider): Promise<string | null>
  sendPasswordReset(email: string): Promise<string | null>
  updatePassword(password: string): Promise<string | null>
  signOut(): Promise<void>
  /** Realtime table subscriptions, or null when Supabase isn't configured or has no realtime. */
  watchTables: NonNullable<AuthClient['watchTables']> | null
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
