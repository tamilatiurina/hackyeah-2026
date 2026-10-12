import {
  AuthContext,
  EmptyState,
  Layout,
  LoadingRows,
  MemoryRouter,
  PageHeader,
  PageShell,
  Route,
  Routes,
  TableFrame,
  buttonPrimary,
  pillClass,
} from 'web'
import type { ReactNode } from 'react'

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

function App({ path, page }: { path: string; page: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <AuthContext value={auth}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={page} />
          </Route>
        </Routes>
      </AuthContext>
    </MemoryRouter>
  )
}

const cell = 'px-5 py-4 align-middle'
const AGENTS = [
  { name: 'Support Assistant', url: 'https://support-agent.acme.example', status: 'Live', live: true, guardrails: '2 attached · 1 mandatory', traffic: '3 sessions · 4 events', next: 'Open' },
  { name: 'Contract Summarizer', url: 'https://legal-ai.acme.example/summarize', status: 'Setup · 3 of 5', live: false, guardrails: '1 attached · 1 mandatory', traffic: 'Not deployed', next: 'Run a test' },
  { name: 'Invoice Reader', url: 'https://invoices.acme.example', status: 'Setup · 1 of 5', live: false, guardrails: '0 attached · 1 mandatory', traffic: 'Not deployed', next: 'Attach guardrails' },
]

export const AgentsPage = () => (
  <App
    path="/agents"
    page={
      <PageShell>
        <PageHeader
          title="Agents"
          description="Proxy agents sit behind a guarded URL. Open one to continue its setup or to see what its guardrails did."
          actions={
            <button type="button" className={buttonPrimary}>
              Register agent
            </button>
          }
        />
        <TableFrame label="Agents table">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead className="bg-[#F9F9F6]">
              <tr className="border-b border-line text-[11px] tracking-[0.08em] text-muted uppercase">
                {['Agent', 'Status', 'Guardrails', 'Traffic'].map((h) => (
                  <th key={h} scope="col" className="px-5 py-3.5 font-semibold">
                    {h}
                  </th>
                ))}
                <th scope="col" className="px-5 py-3.5 text-right font-semibold">
                  Next step
                </th>
              </tr>
            </thead>
            <tbody>
              {AGENTS.map((a) => (
                <tr key={a.name} className="border-b border-line last:border-b-0">
                  <td className={cell}>
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold">{a.name}</span>
                      <span className="font-mono text-xs text-muted">{a.url}</span>
                    </div>
                  </td>
                  <td className={cell}>
                    <span className={`${pillClass} ${a.live ? 'bg-teal-soft text-teal-dark' : 'bg-warn-bg text-warn-fg'}`}>{a.status}</span>
                  </td>
                  <td className={`${cell} text-[13px] whitespace-nowrap`}>{a.guardrails}</td>
                  <td className={`${cell} text-[13px] whitespace-nowrap text-muted`}>{a.traffic}</td>
                  <td className={`${cell} text-right whitespace-nowrap`}>
                    {a.live ? (
                      <span className="inline-flex min-h-9 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium">Open</span>
                    ) : (
                      <span className="inline-flex min-h-9 items-center rounded-lg border border-teal/35 bg-teal-soft px-3 text-[13px] font-semibold text-teal-dark">{a.next}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </PageShell>
    }
  />
)

export const EmptyPage = () => (
  <App
    path="/guardrails"
    page={
      <PageShell>
        <PageHeader title="Guardrails" description="Single checks on text going to or from a proxy agent." />
        <EmptyState title="No guardrails yet" description="Create a guardrail to check text going to or from a proxy agent." />
      </PageShell>
    }
  />
)

export const LoadingPage = () => (
  <App
    path="/audit"
    page={
      <PageShell>
        <PageHeader title="Audit log" />
        <LoadingRows label="Loading audit events" count={4} />
      </PageShell>
    }
  />
)
