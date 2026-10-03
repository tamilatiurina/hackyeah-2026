// The slice of Supabase Auth the app uses; the real adapter is in supabase.ts, tests use a fake.
export interface AuthSession {
  accessToken: string
  email: string
}

export interface AuthClient {
  getSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  /** Resolves to an error message, or null on success. */
  signIn(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
}
