import { useState } from 'react'
import { Link } from 'react-router'
import { useAuditEvents, useLiveRefresh, useSessions } from '../../api/audit'
import type { Agent, AuditAction } from '../../api/types'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { formatCost, formatRelative, shortId } from '../../ui/format'
import { LiveBadge } from '../../ui/LiveBadge'
import { LoadError } from '../ApiUnavailable'
import { agentPath } from './setupProgress'
import { ActionBadge } from './workspaceUi'
import { eventKind } from './workspace'

type Filter = 'all' | AuditAction | 'limit'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'block', label: 'Block' },
  { id: 'redact', label: 'Redact' },
  { id: 'warn', label: 'Warn' },
  { id: 'limit', label: 'Limit' },
]
const LABELS = { block: 'Block', redact: 'Redact', warn: 'Warn', limit: 'Limit' } as const

const th = 'px-3 py-2.5 font-semibold'
const td = 'px-3 py-2.5'
const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** The agent's A2A sessions (counters only, no message content) and its audit events. */
export function AgentActivity({ agent, live }: { agent: Agent; live: boolean }) {
  const sessions = useSessions({ agent_id: agent.id })
  const events = useAuditEvents({ agent_id: agent.id })
  const liveRefresh = useLiveRefresh(['agent_sessions', 'audit_events'], [['sessions'], ['audit-events']])
  const [contextId, setContextId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  if (sessions.isError) return <LoadError what="sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />
  if (events.isError) return <LoadError what="audit events" error={events.error} onRetry={() => void events.refetch()} />
  if (sessions.isPending || events.isPending) {
    return (
      <p role="status" className="m-0 text-sm text-muted">
        Loading activity…
      </p>
    )
  }

  const sessionList = sessions.data.pages.flatMap((p) => p.data)
  const eventList = events.data.pages.flatMap((p) => p.data)

  if (sessionList.length === 0 && eventList.length === 0) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
        <span className="text-[15px] font-semibold">No traffic yet</span>
        <p className="m-0 max-w-[46ch] text-sm leading-[22px] text-muted">
          {live
            ? 'The agent is live. Sessions and audit events appear here once callers use the guarded URL.'
            : 'Sessions and audit events appear once the agent is live and callers use the guarded URL.'}
        </p>
        {!live && (
          <Link to={agentPath(agent.id, 'deploy')} className={`${buttonPrimary} mt-2 no-underline hover:text-white`}>
            Go live
          </Link>
        )}
      </div>
    )
  }

  const byContext = contextId ? eventList.filter((e) => e.context_id === contextId) : eventList
  const counts: Record<Filter, number> = { all: byContext.length, block: 0, redact: 0, warn: 0, limit: 0 }
  for (const e of byContext) counts[eventKind(e)] += 1
  const shown = byContext.filter((e) => filter === 'all' || eventKind(e) === filter)
  const active = sessionList.filter((s) => s.status === 'active').length
  const cost = sessionList.reduce((n, s) => n + s.cost_usd, 0)

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="activity-sessions" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <h2 id="activity-sessions" className="m-0 text-base font-semibold">
              Sessions
            </h2>
            {liveRefresh && <LiveBadge />}
          </div>
          <span className="text-[13px] text-muted">
            {sessionList.length} total · {active} active · {formatCost(cost)}
          </span>
        </div>
        {sessionList.length === 0 ? (
          <p className="m-0 p-5 text-sm text-muted">No sessions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px] tabular-nums">
              <thead>
                <tr className="text-left text-[11px] tracking-[0.04em] text-muted uppercase">
                  <th scope="col" className={`${th} pl-5`}>Context</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={`${th} text-right`}>Turns</th>
                  <th scope="col" className={`${th} text-right whitespace-nowrap`}>Tokens in / out</th>
                  <th scope="col" className={`${th} text-right`}>Cost</th>
                  <th scope="col" className={`${th} text-right`}>Events</th>
                  <th scope="col" className={`${th} pr-5 whitespace-nowrap`}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {sessionList.map((s) => {
                  const picked = contextId === s.context_id
                  return (
                    <tr key={s.context_id} className="border-t border-[#ecece6]">
                      <td className={`${td} pl-5 whitespace-nowrap`}>
                        <button
                          type="button"
                          aria-pressed={picked}
                          title={picked ? 'Show all events' : "Show this session's events"}
                          onClick={() => setContextId(picked ? null : s.context_id)}
                          className={`-ml-2 min-h-8 cursor-pointer rounded-md border-0 px-2 font-mono text-[13px] font-medium ${
                            picked ? 'bg-teal text-white' : 'bg-transparent text-teal hover:bg-teal-soft'
                          }`}
                        >
                          {shortId(s.context_id)}
                        </button>
                      </td>
                      <td className={td}>
                        <span className="inline-flex flex-col gap-0.5">
                          <ActionBadge action={s.status === 'active' ? 'redact' : 'block'}>
                            {s.status === 'active' ? 'Active' : 'Stopped'}
                          </ActionBadge>
                          {s.stop_reason && <span className="text-xs whitespace-nowrap text-muted">{s.stop_reason}</span>}
                        </span>
                      </td>
                      <td className={`${td} text-right`}>{s.turns}</td>
                      <td className={`${td} text-right whitespace-nowrap`}>
                        {fmtTokens(s.input_tokens)} / {fmtTokens(s.output_tokens)}
                      </td>
                      <td className={`${td} text-right`}>{formatCost(s.cost_usd)}</td>
                      <td className={`${td} text-right`}>{s.events}</td>
                      <td className={`${td} pr-5 whitespace-nowrap text-muted`}>{formatRelative(s.last_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {sessions.hasNextPage && (
          <div className="border-t border-line px-5 py-3">
            <button type="button" className={buttonSecondary} disabled={sessions.isFetchingNextPage} onClick={() => void sessions.fetchNextPage()}>
              {sessions.isFetchingNextPage ? 'Loading…' : 'Load more sessions'}
            </button>
          </div>
        )}
      </section>

      <section aria-labelledby="activity-events" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-b border-line px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="activity-events" className="m-0 text-base font-semibold">
              Audit events
            </h2>
            {contextId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft py-0.5 pr-1 pl-2.5 text-xs font-semibold text-teal-dark">
                <span className="font-mono">{shortId(contextId)}</span>
                <button
                  type="button"
                  aria-label="Clear session filter"
                  onClick={() => setContextId(null)}
                  className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-sm text-inherit hover:bg-teal/15"
                >
                  ×
                </button>
              </span>
            )}
          </div>
          <div role="group" aria-label="Filter by action" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => {
              const on = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f.id)}
                  className={`min-h-8 cursor-pointer rounded-full border px-2.5 text-xs font-semibold ${
                    on ? 'border-teal bg-teal text-white' : 'border-line-strong bg-surface text-[#30343B] hover:bg-canvas'
                  }`}
                >
                  {f.label} <span className={on ? 'opacity-80' : 'text-muted'}>{counts[f.id]}</span>
                </button>
              )
            })}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="m-0 p-5 text-sm text-muted">
            {contextId || filter !== 'all' ? 'No events match these filters.' : 'No guardrail or limit events yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] tracking-[0.04em] text-muted uppercase">
                  <th scope="col" className={`${th} pl-5`}>When</th>
                  <th scope="col" className={th}>Context</th>
                  <th scope="col" className={th}>Rule</th>
                  <th scope="col" className={th}>Stage</th>
                  <th scope="col" className={th}>Action</th>
                  <th scope="col" className={`${th} pr-5`}>Details</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => {
                  const kind = eventKind(e)
                  return (
                    <tr key={e.id} className="border-t border-[#ecece6]">
                      <td className={`${td} pl-5 whitespace-nowrap text-muted`}>{formatRelative(e.at)}</td>
                      <td className={`${td} font-mono text-xs whitespace-nowrap`} title={e.context_id ?? undefined}>
                        {e.context_id ? shortId(e.context_id) : '—'}
                      </td>
                      <td className={`${td} font-semibold whitespace-nowrap`}>{e.rule_name}</td>
                      <td className={`${td} text-muted capitalize`}>{e.stage ?? '—'}</td>
                      <td className={td}>
                        <ActionBadge action={kind}>{LABELS[kind]}</ActionBadge>
                      </td>
                      <td className={`${td} min-w-[200px] pr-5 text-[#30343B]`}>{e.details}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {events.hasNextPage && (
          <div className="border-t border-line px-5 py-3">
            <button type="button" className={buttonSecondary} disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
              {events.isFetchingNextPage ? 'Loading…' : 'Load more events'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
