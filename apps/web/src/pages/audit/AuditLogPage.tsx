import { useSearchParams } from 'react-router'
import { useAgents } from '../../api/agents'
import { useAuditEvents, useAuditRules } from '../../api/audit'
import type { AuditAction, AuditEvent, AuditFilters } from '../../api/types'
import { badgeClass, buttonSecondary, inputClass } from '../../ui/classes'
import { formatTime, shortId } from '../../ui/format'
import { LoadError } from '../ApiUnavailable'

const ACTIONS: Record<AuditAction, { label: string; className: string }> = {
  block: { label: 'Block', className: 'bg-[#FBE7E2] text-danger' },
  redact: { label: 'Redact', className: 'bg-warn-bg text-warn-fg' },
  warn: { label: 'Warn', className: 'bg-warn-bg text-warn-fg' },
}
const FILTER_KEYS = ['agent_id', 'rule_id', 'action', 'context_id'] as const
const HEADERS = ['Time', 'Agent', 'Session', 'Rule', 'Stage', 'Result', 'Config', 'Details']
const cell = 'px-4 py-3 align-top'
const labelClass = 'text-[13px] font-semibold text-[#30343B]'

function readFilters(params: URLSearchParams): AuditFilters {
  const action = params.get('action')
  return {
    agent_id: params.get('agent_id') || undefined,
    rule_id: params.get('rule_id') || undefined,
    action: action === 'block' || action === 'redact' || action === 'warn' ? action : undefined,
    context_id: params.get('context_id') || undefined,
  }
}

export function AuditLogPage() {
  const [params, setParams] = useSearchParams()
  const filters = readFilters(params)
  const events = useAuditEvents(filters)
  const rules = useAuditRules()
  const agents = useAgents()
  const filtered = FILTER_KEYS.some((key) => filters[key])

  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  const agentName = (event: AuditEvent) =>
    event.agent_name ?? agents.data?.find((a) => a.id === event.agent_id)?.name ?? event.agent_id
  const list = events.data?.pages.flatMap((page) => page.data) ?? []
  const guardrailRules = rules.data?.filter((r) => r.kind === 'guardrail') ?? []
  const limitRules = rules.data?.filter((r) => r.kind === 'limit') ?? []

  let content
  if (events.isError) {
    content = <LoadError what="audit events" error={events.error} onRetry={() => void events.refetch()} />
  } else if (events.isPending) {
    content = <p className="m-0 text-sm text-muted">Loading audit events…</p>
  } else if (list.length === 0) {
    content = (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        {filtered ? 'No events match these filters.' : 'No audit events yet. Blocks, redactions, warnings and limit hits appear here.'}
      </div>
    )
  } else {
    content = (
      <>
        <div role="region" aria-label="Audit events table" tabIndex={0} className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs tracking-[0.04em] text-muted uppercase">
                {HEADERS.map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((event) => (
                <tr key={event.id} className="border-b border-line last:border-b-0">
                  <td className={`${cell} whitespace-nowrap text-muted`}>{formatTime(event.at)}</td>
                  <td className={cell}>{agentName(event)}</td>
                  <td className={`${cell} font-mono text-xs`} title={event.context_id ?? undefined}>
                    {event.context_id ? shortId(event.context_id) : '—'}
                  </td>
                  <td className={cell}>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold">{event.rule_name}</span>
                      <span className="text-xs text-muted">{event.kind === 'limit' ? 'Limit' : 'Guardrail'}</span>
                    </span>
                  </td>
                  <td className={`${cell} text-muted`}>{event.stage ?? '—'}</td>
                  <td className={cell}>
                    <span className={`${badgeClass} ${ACTIONS[event.action].className}`}>{ACTIONS[event.action].label}</span>
                  </td>
                  <td className={`${cell} font-mono text-xs text-muted`}>{event.config_version ?? '—'}</td>
                  <td className={`${cell} max-w-80`}>{event.details || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {events.hasNextPage && (
          <button type="button" className={`${buttonSecondary} self-start`} disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
            {events.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Audit log</h1>
          <p className="m-0 text-[15px] text-muted">Every block, redaction, warning and limit hit, newest first.</p>
        </div>
        <button type="button" className={buttonSecondary} onClick={() => void events.refetch()}>Refresh</button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-col gap-1.5">
          <label htmlFor="audit-agent" className={labelClass}>Agent</label>
          <select id="audit-agent" value={filters.agent_id ?? ''} onChange={(e) => setFilter('agent_id', e.target.value)} className={inputClass}>
            <option value="">All agents</option>
            {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex min-w-48 flex-col gap-1.5">
          <label htmlFor="audit-rule" className={labelClass}>Rule</label>
          <select id="audit-rule" value={filters.rule_id ?? ''} onChange={(e) => setFilter('rule_id', e.target.value)} className={inputClass}>
            <option value="">All rules</option>
            {guardrailRules.length > 0 && (
              <optgroup label="Guardrails">
                {guardrailRules.map((r) => <option key={r.rule_id} value={r.rule_id}>{r.rule_name}</option>)}
              </optgroup>
            )}
            {limitRules.length > 0 && (
              <optgroup label="Limits">
                {limitRules.map((r) => <option key={r.rule_id} value={r.rule_id}>{r.rule_name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex min-w-40 flex-col gap-1.5">
          <label htmlFor="audit-action" className={labelClass}>Result</label>
          <select id="audit-action" value={filters.action ?? ''} onChange={(e) => setFilter('action', e.target.value)} className={inputClass}>
            <option value="">All results</option>
            <option value="block">Block</option>
            <option value="redact">Redact</option>
            <option value="warn">Warn</option>
          </select>
        </div>
        {filters.context_id && (
          <span className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-canvas px-3 text-sm">
            Session <code className="text-xs">{shortId(filters.context_id)}</code>
            <button type="button" aria-label={`Remove session filter ${filters.context_id}`} onClick={() => setFilter('context_id', '')} className="cursor-pointer border-0 bg-transparent text-muted">
              ×
            </button>
          </span>
        )}
        {filtered && (
          <button type="button" className={buttonSecondary} onClick={() => setParams(new URLSearchParams())}>Clear filters</button>
        )}
      </div>

      {content}
    </section>
  )
}
