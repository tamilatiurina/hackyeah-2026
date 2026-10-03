import { useEffect, useRef, useState } from 'react'
import { useDeleteMcpServer, useMcpServers } from '../../api/mcpServers'
import type { McpServer } from '../../api/types'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { RegisterMcpServerForm } from './RegisterMcpServerForm'

const HEADERS = ['Server', 'URL', 'Auth', 'Allowed tools', 'Agents', '']
const cell = 'px-4 py-3 align-middle'

function authSummary(auth: McpServer['auth']): string {
  if (auth.type === 'api_key') return `API key (${auth.header ?? 'Authorization'})`
  if (auth.type === 'oauth') return `OAuth (${auth.client_id ?? 'client'})`
  return 'None'
}

export function McpServersPage() {
  const servers = useMcpServers()
  const [registering, setRegistering] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const registerButtonRef = useRef<HTMLButtonElement>(null)
  const wasRegistering = useRef(false)

  // Give focus back to "Register MCP server" when the form closes.
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
  if (servers.isError) {
    content = (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-6">
        <span className="text-sm">Couldn't load MCP servers.</span>
        <button type="button" className={buttonSecondary} onClick={() => void servers.refetch()}>
          Retry
        </button>
      </div>
    )
  } else if (servers.isPending) {
    content = <p className="m-0 text-sm text-muted">Loading MCP servers…</p>
  } else if (servers.data.length === 0) {
    content = (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        No MCP servers registered yet.
      </div>
    )
  } else {
    content = <McpServersTable servers={servers.data} highlightId={highlightId} />
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">MCP servers</h1>
          <p className="m-0 text-[15px] text-muted">
            Tool servers agents may use. Only the tools listed here are allowed; credentials are stored by
            the hub and never shown again.
          </p>
        </div>
        {servers.isSuccess && !registering && (
          <button ref={registerButtonRef} type="button" className={buttonPrimary} onClick={() => setRegistering(true)}>
            Register MCP server
          </button>
        )}
      </header>
      {registering && (
        <RegisterMcpServerForm
          onClose={() => setRegistering(false)}
          onRegistered={(server) => setHighlightId(server.id)}
        />
      )}
      {content}
    </section>
  )
}

function McpServersTable({ servers, highlightId }: { servers: readonly McpServer[]; highlightId: string | null }) {
  const remove = useDeleteMcpServer()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-3">
      {remove.isError && (
        <p role="alert" className="m-0 text-sm text-danger">
          {remove.error.message}
        </p>
      )}
      <div
        role="region"
        aria-label="MCP servers table"
        tabIndex={0}
        className="overflow-x-auto rounded-xl border border-line bg-surface"
      >
        <table className="w-full min-w-[880px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs tracking-[0.04em] text-muted uppercase">
              {HEADERS.map((header, i) => (
                <th key={header || i} scope="col" className="px-4 py-3 font-semibold">
                  {header || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => {
              const highlighted = server.id === highlightId
              return (
                <tr
                  key={server.id}
                  data-highlight={highlighted}
                  className={`border-b border-line transition-colors last:border-b-0 ${highlighted ? 'bg-teal-soft' : ''}`}
                >
                  <th scope="row" className={`${cell} font-semibold`}>
                    {server.name}
                  </th>
                  <td className={`${cell} font-mono text-[13px] break-all text-muted`}>{server.url}</td>
                  <td className={`${cell} whitespace-nowrap ${server.auth.type === 'none' ? 'text-muted' : ''}`}>
                    {authSummary(server.auth)}
                  </td>
                  <td className={cell}>
                    <ul aria-label={`Tools of ${server.name}`} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {server.allowed_tools.map((tool) => (
                        <li key={tool} className="rounded-md bg-canvas px-2 py-0.5 font-mono text-xs">
                          {tool}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className={`${cell} text-muted`}>{server.agents}</td>
                  <td className={`${cell} text-right`}>
                    {confirmingId === server.id ? (
                      <button
                        type="button"
                        autoFocus
                        disabled={remove.isPending}
                        onBlur={() => setConfirmingId(null)}
                        onClick={() => remove.mutate(server.id, { onSettled: () => setConfirmingId(null) })}
                        aria-label={`Confirm delete ${server.name}`}
                        className={`${buttonSecondary} border-danger px-3 text-xs text-danger`}
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete ${server.name}`}
                        onClick={() => {
                          remove.reset()
                          setConfirmingId(server.id)
                        }}
                        className={`${buttonSecondary} px-3 text-xs`}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
