import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { useAgents } from '../../api/agents'
import { useLiveRefresh, useSessions } from '../../api/audit'
import type { AgentSession, SessionFilters } from '../../api/types'
import { buttonSecondary, inputClass, pillClass } from '../../ui/classes'
import { formatCost, formatDuration, formatRelative, formatTime, shortId } from '../../ui/format'
import { LiveBadge } from '../../ui/LiveBadge'
import { LoadError } from '../ApiUnavailable'

const HEADERS = ['Agent', 'Session', 'Started', 'Turns', 'Tokens (in / out)', 'Cost', 'Duration', 'Status', 'Events']
const cell = 'px-4 py-3 align-top'
const labelClass = 'text-[13px] font-semibold text-[#30343B]'
const key = (s: AgentSession) => `${s.agent_id}/${s.context_id}`

export function SessionsPage() {
  const [filters, setFilters] = useState<SessionFilters>({})
  const [open, setOpen] = useState<string | null>(null)
  const sessions = useSessions(filters)
  const agents = useAgents()
  // audit_events too: a session's "N events" count changes when an event is recorded.
  const live = useLiveRefresh(['agent_sessions', 'audit_events'], [['sessions']])
  const list = sessions.data?.pages.flatMap((page) => page.data) ?? []
  const agentName = (s: AgentSession) => s.agent_name ?? agents.data?.find((a) => a.id === s.agent_id)?.name ?? s.agent_id

  let content
  if (sessions.isError) {
    content = <LoadError what="sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />
  } else if (sessions.isPending) {
    content = <p className="m-0 text-sm text-muted">Loading sessions…</p>
  } else if (list.length === 0) {
    content = (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        {filters.agent_id || filters.status ? 'No sessions match these filters.' : "No sessions yet. Calls through an agent's guarded URL show up here."}{' '}
        <Link to="/agents" className="font-semibold">Go to Agents</Link>
      </div>
    )
  } else {
    content = (
      <>
        <div role="region" aria-label="Sessions table" tabIndex={0} className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs tracking-[0.04em] text-muted uppercase">
                {HEADERS.map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const expanded = open === key(s)
                return (
                  <Fragment key={key(s)}>
                    <tr className="border-b border-line last:border-b-0">
                      <td className={cell}>
                        <Link to={`/agents/${s.agent_id}`} className="font-semibold">{agentName(s)}</Link>
                      </td>
                      <td className={`${cell} font-mono text-xs`} title={s.context_id}>{shortId(s.context_id)}</td>
                      <td className={`${cell} whitespace-nowrap text-muted`} title={formatTime(s.started_at)}>{formatRelative(s.started_at)}</td>
                      <td className={cell}>{s.turns}</td>
                      <td className={`${cell} whitespace-nowrap`}>{s.input_tokens} / {s.output_tokens}</td>
                      <td className={cell}>{formatCost(s.cost_usd)}</td>
                      <td className={cell}>{formatDuration(s.duration_seconds)}</td>
                      <td className={cell}>
                        <span className="flex flex-col items-start gap-1">
                          {s.status === 'stopped' ? (
                            <span className={`${pillClass} bg-[#FBE7E2] text-danger`}>Stopped</span>
                          ) : (
                            <span className={`${pillClass} bg-teal-soft text-teal-dark`}>Active</span>
                          )}
                          {s.stop_reason && <span className="text-xs text-muted">{s.stop_reason}</span>}
                          {s.limits.length > 0 && (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? 'Hide' : 'Show'} limits for ${s.context_id}`}
                              onClick={() => setOpen(expanded ? null : key(s))}
                              className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-teal-dark"
                            >
                              {expanded ? 'Hide limits' : 'Show limits'}
                            </button>
                          )}
                        </span>
                      </td>
                      <td className={cell}>
                        {s.events > 0 ? (
                          <Link to={`/audit?context_id=${encodeURIComponent(s.context_id)}`}>
                            {s.events} {s.events === 1 ? 'event' : 'events'}
                          </Link>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-line bg-canvas">
                        <td colSpan={HEADERS.length} className="px-4 py-3">
                          <ul className="m-0 flex max-w-md list-none flex-col gap-2 p-0">
                            {s.limits.map((l) => (
                              <li key={l.name} className="flex flex-col gap-1 text-sm">
                                <span>{l.name}: {l.used} / {l.max}{l.unit ? ` ${l.unit}` : ''}</span>
                                <progress value={Math.min(l.used, l.max)} max={l.max} aria-label={l.name} className="h-2 w-full" />
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {sessions.hasNextPage && (
          <button type="button" className={`${buttonSecondary} self-start`} disabled={sessions.isFetchingNextPage} onClick={() => void sessions.fetchNextPage()}>
            {sessions.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Sessions</h1>
          <p className="m-0 text-[15px] text-muted">
            One row per A2A conversation (contextId) through the guarded URL. Counters only, no message content.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {live && <LiveBadge />}
          <button type="button" className={buttonSecondary} onClick={() => void sessions.refetch()}>Refresh</button>
        </div>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-col gap-1.5">
          <label htmlFor="sessions-agent" className={labelClass}>Agent</label>
          <select id="sessions-agent" value={filters.agent_id ?? ''} onChange={(e) => setFilters((f) => ({ ...f, agent_id: e.target.value || undefined }))} className={inputClass}>
            <option value="">All agents</option>
            {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex min-w-40 flex-col gap-1.5">
          <label htmlFor="sessions-status" className={labelClass}>Status</label>
          <select
            id="sessions-status"
            value={filters.status ?? ''}
            onChange={(e) => {
              const value = e.target.value
              setFilters((f) => ({ ...f, status: value === 'active' || value === 'stopped' ? value : undefined }))
            }}
            className={inputClass}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="stopped">Stopped</option>
          </select>
        </div>
      </div>
      {content}
    </section>
  )
}
