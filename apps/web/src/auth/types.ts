// The slice of Supabase Auth the app uses; the real adapter is in supabase.ts, tests use a fake.
export interface AuthSession {
  accessToken: string
  email: string
  /** A Supabase anonymous (guest) user. */
  anonymous: boolean
}

export interface AuthClient {
  getSession(): Promise<AuthSession | null>
  /** Exchanges the refresh token for a new access token; null if that is no longer possible. */
  refreshSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  /** Resolves to an error message, or null on success. */
  signIn(email: string, password: string): Promise<string | null>
  /** Starts a guest session. Resolves to an error message, or null on success. */
  signInAnonymously(): Promise<string | null>
  signOut(): Promise<void>
  /** Realtime (#102): calls onChange when rows of these tables change (RLS applies), and onStatus
   * with whether the subscription is live. Returns the unsubscribe. Absent without realtime. */
  watchTables?(
    tables: readonly string[],
    onChange: () => void,
    onStatus: (live: boolean) => void,
  ): () => void
}
