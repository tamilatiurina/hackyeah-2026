import type { AuthClient, AuthSession } from '../auth/types'

export const DEMO_EMAIL = 'demo@guardrail.local'
export const DEMO_PASSWORD = 'demo-password'
export const TEST_TOKEN = 'test-token'

export interface FakeAuth extends AuthClient {
  session: AuthSession | null
  refreshCalls: number
}

export function createFakeAuth({ signedIn = true }: { signedIn?: boolean } = {}): FakeAuth {
  const listeners = new Set<(s: AuthSession | null) => void>()
  const emit = (s: AuthSession | null) => listeners.forEach((cb) => cb(s))
  const fake: FakeAuth = {
    session: signedIn ? { accessToken: TEST_TOKEN, email: DEMO_EMAIL } : null,
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
      fake.session = { accessToken: TEST_TOKEN, email }
      emit(fake.session)
      return null
    },
    async signOut() {
      fake.session = null
      emit(null)
    },
  }
  return fake
}
