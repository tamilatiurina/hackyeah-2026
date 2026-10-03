import { createContext, useContext } from 'react'
import type { AuthSession } from './types'

export const SESSION_EXPIRED = 'Your session expired. Sign in again.'

export interface AuthState {
  status: 'loading' | 'ready'
  session: AuthSession | null
  configured: boolean
  /** Why the user was signed out, shown on the sign-in page (e.g. SESSION_EXPIRED). */
  notice: string | null
  signIn(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
