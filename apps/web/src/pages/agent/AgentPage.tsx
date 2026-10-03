import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { agentKeys, useAgent, useDeleteAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { AgentDeploy } from './AgentDeploy'
import { AgentGuardrails } from './AgentGuardrails'
import { AgentOverview } from './AgentOverview'
import { EditAgentForm } from './EditAgentForm'

const backLink = 'inline-flex min-h-11 items-center text-sm font-semibold no-underline'

export function AgentPage() {
  const { agentId = '' } = useParams()
  const agent = useAgent(agentId)
  const [editing, setEditing] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing) editButtonRef.current?.focus()
    wasEditing.current = editing
  }, [editing])

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const remove = useDeleteAgent()
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 5000)
    return () => clearTimeout(timer)
  }, [confirming])

  const deleteError =
    remove.error instanceof ApiError && remove.error.status === 405
      ? "Deleting agents isn't available on this API yet."
      : remove.error?.message

  if (agent.isPending) {
    return (
      <section aria-busy="true" className="flex flex-col gap-6">
        <span className="block h-8 w-64 animate-pulse rounded bg-[#ECECE6]" />
        <span className="block h-48 animate-pulse rounded-xl bg-[#ECECE6]" />
      </section>
    )
  }

  if (agent.isError) {
    const notFound = agent.error instanceof ApiError && (agent.error.status === 404 || agent.error.status === 422)
    return notFound ? (
      <section className="flex flex-col items-start gap-4">
        <h1 className="m-0 text-[28px] font-semibold tracking-tight">Agent not found</h1>
        <Link to="/agents" className={backLink}>
          Back to agents
        </Link>
      </section>
    ) : (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-6">
        <span className="text-sm">Couldn't load this agent.</span>
        <button type="button" className={buttonSecondary} onClick={() => void agent.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link to="/agents" className={`${backLink} self-start`}>
          ← Agents
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight break-words">{agent.data.name}</h1>
          {!editing && (
            <div className="flex flex-wrap gap-2">
              <button ref={editButtonRef} type="button" className={buttonPrimary} onClick={() => setEditing(true)}>
                Edit
              </button>
              {confirming ? (
                <button
                  type="button"
                  autoFocus
                  disabled={remove.isPending}
                  onBlur={() => setConfirming(false)}
                  onClick={() =>
                    remove.mutate(agent.data.id, {
                      onSuccess: (_, id) => {
                        navigate('/agents')
                        // After leaving the page (removing it while mounted would refetch → 404 flash),
                        // so browser Back doesn't show the deleted agent from cache.
                        setTimeout(() => queryClient.removeQueries({ queryKey: agentKeys.agent(id), exact: true }))
                      },
                    })
                  }
                  className={`${buttonSecondary} border-danger text-danger`}
                >
                  Confirm delete
                </button>
              ) : (
                <button type="button" className={buttonSecondary} onClick={() => setConfirming(true)}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
        {deleteError && (
          <p role="alert" className="m-0 text-sm text-danger">
            {deleteError}
          </p>
        )}
      </header>
      {editing ? (
        <EditAgentForm agent={agent.data} onClose={() => setEditing(false)} />
      ) : (
        <AgentOverview agent={agent.data} />
      )}
      <AgentGuardrails agent={agent.data} />
      <AgentDeploy agent={agent.data} />
    </section>
  )
}
