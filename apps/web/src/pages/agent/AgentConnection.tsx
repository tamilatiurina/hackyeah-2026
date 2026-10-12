import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { agentKeys, useDeleteAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import type { Agent } from '../../api/types'
import { buttonSecondary } from '../../ui/classes'
import { useToast } from '../../ui/toastContext'
import { cardSummary } from '../agents/agentDisplay'
import { EditAgentForm } from './EditAgentForm'
import { sectionCard, sectionText, sectionTitle, smallButton, term } from './workspaceUi'

const value = 'm-0 text-sm'

/** Setup step 1: what the hub read from the Agent Card, editing it, and deleting the agent. */
export function AgentConnection({ agent }: { agent: Agent }) {
  const [editing, setEditing] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  const toast = useToast()

  useEffect(() => {
    if (wasEditing.current && !editing) editButtonRef.current?.focus()
    wasEditing.current = editing
  }, [editing])

  return (
    <div className="flex flex-col gap-6">
      {editing ? (
        <EditAgentForm
          agent={agent}
          onClose={() => setEditing(false)}
          onSaved={(saved) => toast(saved.config_version ? `Saved. Config v${saved.config_version}.` : 'Saved.')}
        />
      ) : (
        <section aria-labelledby="connection-title" className={sectionCard}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="connection-title" className={sectionTitle}>
                Connection
              </h2>
              <p className={sectionText}>
                The hub read this from the agent's Agent Card. Callers never reach these URLs directly once the agent
                is live.
              </p>
            </div>
            <button ref={editButtonRef} type="button" className={smallButton} onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
          <dl aria-label="Connection details" className="m-0 grid gap-x-6 gap-y-3.5 sm:grid-cols-[minmax(110px,12rem)_minmax(0,1fr)]">
            <dt className={term}>Description</dt>
            <dd className={value}>{agent.description || '—'}</dd>
            <dt className={term}>Agent URL</dt>
            <dd className={`${value} min-w-0 overflow-x-auto font-mono text-[13px] whitespace-nowrap`}>{agent.base_url}</dd>
            <dt className={term}>A2A endpoint</dt>
            <dd className={`${value} min-w-0 overflow-x-auto font-mono text-[13px] whitespace-nowrap`}>{agent.upstream_url}</dd>
            <dt className={term}>Agent Card</dt>
            <dd className={value}>
              {agent.agent_card ? (
                cardSummary(agent.agent_card)
              ) : (
                <span className="text-danger">
                  No Agent Card. This agent was registered before A2A; delete it and register it again.
                </span>
              )}
            </dd>
            {agent.agent_card && agent.agent_card.skills.length > 0 && (
              <>
                <dt className={term}>Skills</dt>
                <dd className={value}>
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {agent.agent_card.skills.map((skill) => (
                      <li key={skill.id} title={skill.description} className="rounded-md bg-[#F0F0EB] px-2 py-0.5 text-[13px]">
                        {skill.name}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            <dt className={term}>Auth header</dt>
            <dd className={`${value} ${agent.auth_header_name ? 'font-mono text-[13px]' : 'text-muted'}`}>
              {agent.auth_header_name ?? 'None'}
            </dd>
            <dt className={term}>ID</dt>
            <dd className={`${value} font-mono text-[13px] break-all`}>{agent.id}</dd>
            {agent.config_version !== undefined && (
              <>
                <dt className={term}>Config version</dt>
                <dd className={value}>{agent.config_version}</dd>
              </>
            )}
          </dl>
        </section>
      )}
      <DeleteAgent agent={agent} />
    </div>
  )
}

function DeleteAgent({ agent }: { agent: Agent }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const remove = useDeleteAgent()
  const [confirming, setConfirming] = useState(false)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)

  const error =
    remove.error instanceof ApiError && remove.error.status === 405
      ? "Deleting agents isn't available on this API yet."
      : remove.error?.message

  return (
    <section aria-labelledby="delete-agent-title" className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-6 py-5">
      <div className="flex flex-[1_1_320px] flex-col gap-1">
        <h2 id="delete-agent-title" className="m-0 text-base font-semibold">
          Delete agent
        </h2>
        <p className="m-0 text-sm leading-[22px] text-muted">
          The guarded URL stops answering and the gateway key stops working. Sessions and audit events stay in the log.
        </p>
        {error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      {confirming ? (
        <div
          role="group"
          aria-label="Confirm agent deletion"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-[#FBE7E2] p-2"
        >
          <span className="px-1 text-sm font-semibold text-danger">Delete {agent.name}?</span>
          <button
            type="button"
            className={buttonSecondary}
            disabled={remove.isPending}
            onClick={() => {
              setConfirming(false)
              requestAnimationFrame(() => deleteButtonRef.current?.focus())
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            disabled={remove.isPending}
            className={`${buttonSecondary} border-danger font-semibold text-danger`}
            onClick={() =>
              remove.mutate(agent.id, {
                onSuccess: (_, id) => {
                  navigate('/agents')
                  toast(`Deleted ${agent.name}. Its guarded URL no longer answers.`)
                  // After leaving the page (removing it while mounted would refetch → 404 flash),
                  // so browser Back doesn't show the deleted agent from cache.
                  setTimeout(() => queryClient.removeQueries({ queryKey: agentKeys.agent(id), exact: true }))
                },
              })
            }
          >
            {remove.isPending ? 'Deleting…' : 'Confirm delete'}
          </button>
        </div>
      ) : (
        <button
          ref={deleteButtonRef}
          type="button"
          className={`${buttonSecondary} text-danger hover:bg-[#FBE7E2]`}
          onClick={() => setConfirming(true)}
        >
          Delete…
        </button>
      )}
    </section>
  )
}
