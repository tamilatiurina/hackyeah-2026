import { useState } from 'react'
import { Link } from 'react-router'
import { useAgentMcpServers, useRemoveAgentMcpServer, useSetAgentMcpServer } from '../../api/agentMcpServers'
import { useMcpServers } from '../../api/mcpServers'
import type { Agent, AgentMcpServer } from '../../api/types'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'

const small = `${buttonSecondary} px-3 text-xs`

/** FR-17: which registered MCP servers this agent may use, and which of their tools. The agent gets
 * this list on every call (params.metadata.guardrailHub.mcpServers); credentials stay in the hub. */
export function AgentMcpServers({ agent }: { agent: Agent }) {
  const access = useAgentMcpServers(agent.id)
  const servers = useMcpServers()
  const set = useSetAgentMcpServer(agent.id)
  const remove = useRemoveAgentMcpServer(agent.id)
  const [adding, setAdding] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  const attached = new Set(access.data?.map((e) => e.server_id))
  const available = servers.data?.filter((s) => !attached.has(s.id)) ?? []
  const toAdd = available.some((s) => s.id === adding) ? adding : (available[0]?.id ?? '')

  const add = () => {
    const server = available.find((s) => s.id === toAdd)
    if (!server) return
    setError(null)
    set.mutate(
      { serverId: server.id, tools: server.allowed_tools },
      {
        onSuccess: () => setStatus(`Added ${server.name} with all of its tools.`),
        onError: (e) => setError(e.message),
      },
    )
  }

  let content
  if (access.isError) {
    content = (
      <p role="alert" className="m-0 text-sm">
        Couldn't load this agent's MCP servers.{' '}
        <button type="button" className={small} onClick={() => void access.refetch()}>
          Retry
        </button>
      </p>
    )
  } else if (access.isPending) {
    content = <p className="m-0 text-sm text-muted">Loading MCP servers…</p>
  } else if (access.data.length === 0) {
    content = <p className="m-0 text-sm text-muted">This agent has no MCP servers yet.</p>
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
                      setStatus(`Saved the tools for ${entry.name}.`)
                      done(null)
                    },
                    onError: (e) => done(e.message),
                  },
                )
              }
              onRemove={() =>
                remove.mutate(entry.server_id, {
                  onSuccess: () => setStatus(`Removed ${entry.name}.`),
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
    <section
      aria-labelledby="agent-mcp-title"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="agent-mcp-title" className="m-0 text-lg font-semibold">
          MCP servers
        </h2>
        <p className="m-0 text-sm text-muted">
          Tool servers this agent may use, and which of their tools. The agent receives this list on every call;
          credentials stay in the hub.
        </p>
      </div>
      <p role="status" className="m-0 text-sm text-teal-dark empty:hidden">
        {status}
      </p>
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}

      {content}

      {servers.isSuccess && servers.data.length === 0 ? (
        <p className="m-0 text-sm text-muted">
          No MCP servers are registered yet.{' '}
          <Link to="/mcp" className="font-semibold">
            Register one
          </Link>
        </p>
      ) : (
        available.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-56 flex-col gap-1.5">
              <label htmlFor="agent-mcp-add" className="text-[13px] font-semibold text-[#30343B]">
                Add MCP server
              </label>
              <select
                id="agent-mcp-add"
                value={toAdd}
                onChange={(e) => setAdding(e.target.value)}
                className={inputClass}
              >
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className={buttonSecondary} disabled={set.isPending} onClick={add}>
              Add
            </button>
          </div>
        )
      )}
    </section>
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
    <fieldset aria-labelledby={legendId} className="m-0 flex flex-col gap-3 rounded-lg border border-line p-4">
      <div id={legendId} className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{entry.name}</span>
        <span className="font-mono text-xs break-all text-muted">{entry.url}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {entry.available_tools.map((tool) => (
          <label key={tool} className="flex min-h-9 items-center gap-2 font-mono text-[13px]">
            <input type="checkbox" checked={chosen.has(tool)} onChange={() => toggle(tool)} />
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
      <div className="flex flex-wrap justify-end gap-2">
        {dirty && (
          <button
            type="button"
            aria-label={`Save tools for ${entry.name}`}
            className={`${buttonPrimary} min-h-9 px-3 text-xs`}
            disabled={busy || selection.length === 0}
            onClick={() => onSave(selection, setError)}
          >
            Save
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove ${entry.name}`}
          className={small}
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </fieldset>
  )
}
