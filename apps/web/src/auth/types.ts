// The slice of Supabase Auth the app uses; the real adapter is in supabase.ts, tests use a fake.
export interface AuthSession {
  accessToken: string
  /** Supabase user id: every row the user owns carries it as owner_id. */
  userId: string
  email: string
}

export type OAuthProvider = 'github' | 'google'

export interface SignUpResult {
  /** An error message, or null on success. */
  error: string | null
  /** Supabase sent a confirmation email; the account works once the link is opened. */
  confirmEmail: boolean
}

export interface AuthClient {
  getSession(): Promise<AuthSession | null>
  /** Exchanges the refresh token for a new access token; null if that is no longer possible. */
  refreshSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  /** Resolves to an error message, or null on success. */
  signIn(email: string, password: string): Promise<string | null>
  signUp(email: string, password: string): Promise<SignUpResult>
  /** Leaves for the provider's sign-in page; it comes back to /auth/callback. Resolves to an error
   * message if the redirect could not start. */
  signInWithOAuth(provider: OAuthProvider): Promise<string | null>
  /** Emails a link to /reset-password. Resolves to an error message, or null on success. */
  sendPasswordReset(email: string): Promise<string | null>
  /** Sets a new password for the signed-in (or password-recovery) session. */
  updatePassword(password: string): Promise<string | null>
  signOut(): Promise<void>
  /** Realtime (#102): calls onChange when rows of these tables change (RLS applies), and onStatus
   * with whether the subscription is live. Returns the unsubscribe. Absent without realtime. */
  watchTables?(
    tables: readonly string[],
    onChange: () => void,
    onStatus: (live: boolean) => void,
  ): () => void
}
