import { useEffect, useRef, useState } from 'react'
import { useAgents } from '../../api/agents'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { AgentsTable, AgentsTableSkeleton } from './AgentsTable'
import { RegisterAgentForm } from './RegisterAgentForm'

export function AgentsPage() {
  const agents = useAgents()
  const [registering, setRegistering] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const registerButtonRef = useRef<HTMLButtonElement>(null)
  const wasRegistering = useRef(false)

  // Give focus back to "Register agent" when the form closes (Cancel or success).
  useEffect(() => {
    if (wasRegistering.current && !registering) registerButtonRef.current?.focus()
    wasRegistering.current = registering
  }, [registering])

  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => setHighlightId(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightId])

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
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        No agents yet. Register your first one.
      </div>
    )
  } else {
    content = <AgentsTable agents={agents.data} highlightId={highlightId} />
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Agents</h1>
          <p className="m-0 text-[15px] text-muted">
            Proxy agents sit behind a guarded URL. Register one by its upstream URL; the hub checks it answers
            before saving.
          </p>
        </div>
        {agents.isSuccess && !registering && (
          <button
            ref={registerButtonRef}
            type="button"
            className={buttonPrimary}
            onClick={() => setRegistering(true)}
          >
            Register agent
          </button>
        )}
      </header>
      {registering && (
        <RegisterAgentForm onClose={() => setRegistering(false)} onRegistered={(agent) => setHighlightId(agent.id)} />
      )}
      {content}
    </section>
  )
}
