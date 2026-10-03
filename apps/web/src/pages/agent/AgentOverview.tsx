import type { Agent } from '../../api/types'
import { formatLabel } from '../agents/agentDisplay'

const term = 'text-xs font-semibold tracking-[0.04em] text-muted uppercase'
const value = 'm-0 text-sm'

export function AgentOverview({ agent }: { agent: Agent }) {
  return (
    <section aria-label="Overview" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <dl className="m-0 grid gap-x-8 gap-y-4 sm:grid-cols-[12rem_1fr]">
        <dt className={term}>Description</dt>
        <dd className={value}>{agent.description || '—'}</dd>
        <dt className={term}>Upstream URL</dt>
        <dd className={`${value} font-mono text-[13px] break-all`}>{agent.upstream_url}</dd>
        <dt className={term}>Formats</dt>
        <dd className={value}>
          {formatLabel(agent.request_format)} → {formatLabel(agent.response_format)}
        </dd>
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
  )
}
