import { useState } from 'react'
import { Link } from 'react-router'
import { useAgentMcpServers, useRemoveAgentMcpServer, useSetAgentMcpServer } from '../../api/agentMcpServers'
import { useCompleteSetupStep } from '../../api/agents'
import { useMcpServers } from '../../api/mcpServers'
import type { Agent, AgentMcpServer } from '../../api/types'
import { buttonPrimary } from '../../ui/classes'
import { useToast } from '../../ui/toastContext'
import { ChevronRight, sectionCard, sectionText, sectionTitle, smallButton, textLink } from './workspaceUi'

/** Setup step 3 (FR-17), optional: which registered MCP servers this agent may use, and which of
 * their tools. The agent gets this list on every call (params.metadata.agentsOnRails.mcpServers);
 * credentials stay in the hub. */
export function AgentMcpServers({ agent }: { agent: Agent }) {
  const access = useAgentMcpServers(agent.id)
  const servers = useMcpServers()
  const set = useSetAgentMcpServer(agent.id)
  const remove = useRemoveAgentMcpServer(agent.id)
  const completeStep = useCompleteSetupStep(agent.id)
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)

  const attached = new Set(access.data?.map((e) => e.server_id))
  const available = servers.data?.filter((s) => !attached.has(s.id)) ?? []

  const add = (serverId: string) => {
    const server = available.find((s) => s.id === serverId)
    if (!server) return
    setError(null)
    set.mutate(
      { serverId: server.id, tools: server.allowed_tools },
      {
        onSuccess: () => {
          toast(`Added ${server.name} with all of its tools.`)
          // Granting a server finishes the step; record it so the agents list sees it too.
          if (!agent.mcp_reviewed) completeStep.mutate('mcp')
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  let content
  if (access.isError) {
    content = (
      <p role="alert" className="m-0 text-sm">
        Couldn't load this agent's MCP servers.{' '}
        <button type="button" className={smallButton} onClick={() => void access.refetch()}>
          Retry
        </button>
      </p>
    )
  } else if (access.isPending) {
    content = <p className="m-0 text-sm text-muted">Loading MCP servers…</p>
  } else if (access.data.length === 0) {
    content = (
      <p className="m-0 rounded-lg border border-dashed border-line-strong px-3 py-3.5 text-sm text-muted">
        This agent has no MCP servers yet. It answers from its own knowledge only.
      </p>
    )
  } else {
    content = (
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {access.data.map((entry) => (
          <li key={`${entry.server_id}:${entry.allowed_tools.join(',')}:${entry.available_tools.join(',')}`}>
            <ServerAccess
              entry={entry}
              busy={set.isPending || remove.isPending}
              onSave={(tools, done) =>
                set.mutate(
                  { serverId: entry.server_id, tools },
                  {
                    onSuccess: () => {
                      toast(`Saved the tools for ${entry.name}.`)
                      done(null)
                    },
                    onError: (e) => done(e.message),
                  },
                )
              }
              onRemove={() =>
                remove.mutate(entry.server_id, {
                  onSuccess: () => toast(`Removed ${entry.name}.`),
                  onError: (e) => setError(e.message),
                })
              }
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="agent-mcp-title" className={sectionCard}>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="agent-mcp-title" className={sectionTitle}>
              MCP tools
            </h2>
            <span className="rounded-md bg-[#F0F0EB] px-2 py-px text-[11px] font-semibold text-[#30343B]">Optional</span>
          </div>
          <p className={sectionText}>
            Tool servers this agent may use, and which of their tools. The agent receives this list on every call;
            credentials stay in the hub.
          </p>
        </div>
        {error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        )}
        {content}
      </section>

      <section aria-labelledby="agent-mcp-registered" className={sectionCard}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="agent-mcp-registered" className="m-0 text-base font-semibold">
              Registered servers
            </h2>
            <p className={sectionText}>Adding a server grants all of its tools. Untick the ones the agent shouldn't call.</p>
          </div>
          <Link to="/mcp" className={textLink}>
            Register a server
            <ChevronRight />
          </Link>
        </div>
        {servers.isPending ? (
          <p className="m-0 text-sm text-muted">Loading registered servers…</p>
        ) : servers.isError ? (
          <p role="alert" className="m-0 text-sm text-danger">
            Couldn't load the registered MCP servers.
          </p>
        ) : servers.data.length === 0 ? (
          <p className="m-0 text-sm text-muted">No MCP servers are registered yet.</p>
        ) : available.length === 0 ? (
          <p className="m-0 text-sm text-muted">Every registered server is already granted to this agent.</p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-2.5 p-0">
            {available.map((s) => (
              <li key={s.id} className="flex flex-col gap-2.5 rounded-[10px] border border-line p-3.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <span className="font-mono text-xs break-all text-muted">{s.url}</span>
                </div>
                <span className="text-[13px] text-muted">{s.allowed_tools.join(', ') || 'No tools'}</span>
                <button
                  type="button"
                  aria-label={`Add ${s.name}`}
                  className={`${smallButton} self-start font-semibold hover:border-teal hover:bg-teal-soft hover:text-teal-dark`}
                  disabled={set.isPending}
                  onClick={() => add(s.id)}
                >
                  + Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

interface ServerAccessProps {
  entry: AgentMcpServer
  busy: boolean
  /** Saves the selection; `done` gets an error message, or null on success. */
  onSave: (tools: string[], done: (error: string | null) => void) => void
  onRemove: () => void
}

function ServerAccess({ entry, busy, onSave, onRemove }: ServerAccessProps) {
  const [chosen, setChosen] = useState(() => new Set(entry.allowed_tools))
  const [error, setError] = useState<string | null>(null)
  // In the server's own order, so the request lists tools the way the registry does.
  const selection = entry.available_tools.filter((t) => chosen.has(t))
  const dirty = selection.join(',') !== entry.allowed_tools.join(',')
  const legendId = `agent-mcp-${entry.server_id}`

  const toggle = (tool: string) => {
    setError(null)
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(tool)) next.delete(tool)
      else next.add(tool)
      return next
    })
  }

  return (
    <fieldset aria-labelledby={legendId} className="m-0 flex flex-col gap-3 rounded-[10px] border border-line p-4">
      <div id={legendId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[15px] font-semibold">{entry.name}</span>
        <span className="font-mono text-xs break-all text-muted">{entry.url}</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {entry.available_tools.map((tool) => (
          <label key={tool} className="flex min-h-9 cursor-pointer items-center gap-2 font-mono text-[13px]">
            <input type="checkbox" className="size-4 accent-teal" checked={chosen.has(tool)} onChange={() => toggle(tool)} />
            {tool}
          </label>
        ))}
      </div>
      {dirty && selection.length === 0 && (
        <p className="m-0 text-[13px] text-danger">Keep at least one tool, or remove the server.</p>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-muted">
          {selection.length} of {entry.available_tools.length} tools allowed{dirty ? ' · unsaved' : ''}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {dirty && (
            <>
              <button
                type="button"
                className={smallButton}
                onClick={() => {
                  setChosen(new Set(entry.allowed_tools))
                  setError(null)
                }}
              >
                Undo
              </button>
              <button
                type="button"
                aria-label={`Save tools for ${entry.name}`}
                className={`${buttonPrimary} min-h-9 px-3 text-[13px]`}
                disabled={busy || selection.length === 0}
                onClick={() => onSave(selection, setError)}
              >
                Save tools
              </button>
            </>
          )}
          <button type="button" aria-label={`Remove ${entry.name}`} className={smallButton} disabled={busy} onClick={onRemove}>
            Remove server
          </button>
        </span>
      </div>
    </fieldset>
  )
}
