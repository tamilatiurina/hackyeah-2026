import type { AuthClient, AuthSession, OAuthProvider } from '../auth/types'

export const DEMO_EMAIL = 'owner@example.com'
export const DEMO_PASSWORD = 'demo-password'
export const TEST_TOKEN = 'test-token'
export const TEST_USER_ID = '971f4031-2dd9-4327-94c7-45323de61c67'
/** Signing up with this address makes the fake ask for email confirmation first. */
export const CONFIRM_EMAIL = 'confirm@example.com'
export const TAKEN_EMAIL = 'taken@example.com'

export interface FakeAuth extends AuthClient {
  session: AuthSession | null
  refreshCalls: number
  oauthStarted: OAuthProvider[]
  resetEmails: string[]
  passwordUpdates: string[]
  /** Tables with an open realtime subscription. */
  watchedTables(): string[]
  /** Pretends Supabase Realtime reported a change to this table. */
  emitTableChange(table: string): void
  /** Pretends the browser came back from an OAuth provider or email link as this user. */
  arriveAs(email: string, userId?: string): void
}

const sessionFor = (email: string, userId = TEST_USER_ID): AuthSession => ({
  accessToken: TEST_TOKEN,
  userId,
  email,
})

export function createFakeAuth({
  signedIn = true,
  realtime = true,
}: { signedIn?: boolean; realtime?: boolean } = {}): FakeAuth {
  const watchers = new Set<{ tables: readonly string[]; onChange: () => void }>()
  const listeners = new Set<(s: AuthSession | null) => void>()
  const emit = (s: AuthSession | null) => listeners.forEach((cb) => cb(s))
  const fake: FakeAuth = {
    session: signedIn ? sessionFor(DEMO_EMAIL) : null,
    refreshCalls: 0,
    oauthStarted: [],
    resetEmails: [],
    passwordUpdates: [],
    getSession: () => Promise.resolve(fake.session),
    async refreshSession() {
      fake.refreshCalls += 1
      return fake.session
    },
    onAuthStateChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async signIn(email, password) {
      if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) return 'Invalid login credentials'
      fake.session = sessionFor(email)
      emit(fake.session)
      return null
    },
    async signUp(email) {
      if (email === TAKEN_EMAIL) return { error: 'User already registered', confirmEmail: false }
      if (email === CONFIRM_EMAIL) return { error: null, confirmEmail: true }
      fake.session = sessionFor(email, 'new-user-id')
      emit(fake.session)
      return { error: null, confirmEmail: false }
    },
    async signInWithOAuth(provider) {
      fake.oauthStarted.push(provider)
      return null
    },
    async sendPasswordReset(email) {
      fake.resetEmails.push(email)
      return null
    },
    async updatePassword(password) {
      fake.passwordUpdates.push(password)
      return null
    },
    async signOut() {
      fake.session = null
      emit(null)
    },
    arriveAs(email, userId = TEST_USER_ID) {
      fake.session = sessionFor(email, userId)
      emit(fake.session)
    },
    watchedTables: () => [...watchers].flatMap((w) => [...w.tables]),
    emitTableChange: (table) => watchers.forEach((w) => w.tables.includes(table) && w.onChange()),
  }
  if (realtime) {
    fake.watchTables = (tables, onChange, onStatus) => {
      const watcher = { tables, onChange }
      watchers.add(watcher)
      queueMicrotask(() => watchers.has(watcher) && onStatus(true)) // Realtime confirms asynchronously
      return () => {
        watchers.delete(watcher)
        onStatus(false)
      }
    }
  }
  return fake
}
