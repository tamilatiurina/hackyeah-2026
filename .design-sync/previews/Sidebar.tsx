import { AuthContext, MemoryRouter, Sidebar } from 'web'

const noop = () => {}
const auth = {
  status: 'ready' as const,
  session: { accessToken: '', userId: 'preview-user', email: 'maria.kowalska@acme.dev' },
  configured: true,
  notice: null,
  signIn: async () => null,
  signUp: async () => ({ error: null, confirmEmail: false }),
  signInWithOAuth: async () => null,
  sendPasswordReset: async () => null,
  updatePassword: async () => null,
  signOut: async () => {},
  watchTables: null,
}

function Shell({ path }: { path: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <AuthContext value={auth}>
        <div className="h-[760px]">
          <Sidebar id="preview-sidebar" open onNavigate={noop} counts={{ '/audit': 3 }} />
        </div>
      </AuthContext>
    </MemoryRouter>
  )
}

export const Navigation = () => <Shell path="/agents" />
