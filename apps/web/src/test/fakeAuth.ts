import type { AuthClient, AuthSession } from '../auth/types'

export const DEMO_EMAIL = 'demo@guardrail.local'
export const DEMO_PASSWORD = 'demo-password'
export const TEST_TOKEN = 'test-token'

export interface FakeAuth extends AuthClient {
  session: AuthSession | null
  refreshCalls: number
  /** Tables with an open realtime subscription. */
  watchedTables(): string[]
  /** Pretends Supabase Realtime reported a change to this table. */
  emitTableChange(table: string): void
}

export const ANONYMOUS_DISABLED = 'Anonymous sign-ins are disabled'

export function createFakeAuth({
  signedIn = true,
  anonymousEnabled = true,
  realtime = true,
}: { signedIn?: boolean; anonymousEnabled?: boolean; realtime?: boolean } = {}): FakeAuth {
  const watchers = new Set<{ tables: readonly string[]; onChange: () => void }>()
  const listeners = new Set<(s: AuthSession | null) => void>()
  const emit = (s: AuthSession | null) => listeners.forEach((cb) => cb(s))
  const fake: FakeAuth = {
    session: signedIn ? { accessToken: TEST_TOKEN, email: DEMO_EMAIL, anonymous: false } : null,
    refreshCalls: 0,
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
      fake.session = { accessToken: TEST_TOKEN, email, anonymous: false }
      emit(fake.session)
      return null
    },
    async signInAnonymously() {
      if (!anonymousEnabled) return ANONYMOUS_DISABLED
      fake.session = { accessToken: TEST_TOKEN, email: '', anonymous: true }
      emit(fake.session)
      return null
    },
    async signOut() {
      fake.session = null
      emit(null)
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
