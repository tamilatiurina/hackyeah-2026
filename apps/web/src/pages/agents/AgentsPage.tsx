import { Link } from 'react-router'
import { useAgents } from '../../api/agents'
import { useSessions } from '../../api/audit'
import { useAllAgentBindings } from '../../api/bindings'
import { useGuardrails } from '../../api/guardrails'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { PageHeader, PageShell } from '../../ui/Page'
import { AgentsTable, AgentsTableSkeleton, type AgentRow } from './AgentsTable'

const plus = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
)

const FIRST_STEPS = ['Connect by URL', 'Attach guardrails', 'Test the pipeline', 'Go live with a key']

export function AgentsPage() {
  const agents = useAgents()
  const guardrails = useGuardrails()
  const bindings = useAllAgentBindings()
  const sessions = useSessions({})

  const mandatory = new Set((guardrails.data ?? []).filter((g) => g.is_mandatory).map((g) => g.id))
  const sessionList = sessions.data?.pages.flatMap((p) => p.data) ?? []
  const rows: AgentRow[] = (agents.data ?? []).map((agent) => {
    const traffic = sessionList.filter((s) => s.agent_id === agent.id)
    return {
      agent,
      attached: (bindings.data ?? []).filter(
        (b) => b.scope_id === agent.id && b.enabled && !mandatory.has(b.guardrail_id),
      ).length,
      sessions: traffic.length,
      events: traffic.reduce((n, s) => n + s.events, 0),
    }
  })

  let content
  if (agents.isError) {
    content = (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-6">
        <span className="text-sm">Couldn't load agents.</span>
        <button type="button" className={buttonSecondary} onClick={() => void agents.refetch()}>
          Retry
        </button>
      </div>
    )
  } else if (agents.isPending) {
    content = <AgentsTableSkeleton />
  } else if (agents.data.length === 0) {
    content = (
      <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
        <svg aria-hidden="true" viewBox="0 0 48 48" className="mb-5 h-12 w-12 text-teal" fill="none">
          <path d="M24 5.5 39 11v11.3c0 9.2-6.2 16.8-15 20.2-8.8-3.4-15-11-15-20.2V11l15-5.5Z" stroke="currentColor" strokeWidth="2" />
          <path d="M17 24.5h4.4l2.3-6 4.2 12 2.2-6H35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">No agents yet. Register your first one.</h2>
        <p className="mt-2 mb-0 max-w-md text-sm leading-6 text-muted">
          Add an A2A agent to create its guarded URL and begin applying guardrails. Setup takes four steps:
        </p>
        <ol className="m-0 mt-5 flex list-none flex-wrap justify-center gap-2 p-0">
          {FIRST_STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-2 rounded-full bg-[#F0F0EB] px-3 py-1.5 text-[13px] font-medium">
              <span
                className={`flex size-[18px] items-center justify-center rounded-full text-[11px] ${
                  index === 0 ? 'bg-teal font-bold text-white' : 'border-[1.5px] border-line-strong font-semibold text-muted'
                }`}
              >
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <Link to="/agents/new" className={`${buttonPrimary} mt-6 no-underline hover:text-white`}>
          Register agent
        </Link>
      </div>
    )
  } else {
    content = <AgentsTable rows={rows} mandatoryCount={mandatory.size} />
  }

  return (
    <PageShell>
      <PageHeader
        title="Agents"
        description="Proxy agents sit behind a guarded URL. Open one to continue its setup or to see what its guardrails did."
        actions={
          agents.isSuccess && agents.data.length > 0 ? (
            <Link to="/agents/new" className={`${buttonPrimary} no-underline hover:text-white`}>
              {plus}
              Register agent
            </Link>
          ) : undefined
        }
      />
      {content}
    </PageShell>
  )
}
