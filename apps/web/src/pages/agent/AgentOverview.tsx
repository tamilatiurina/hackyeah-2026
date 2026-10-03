import type { Agent } from '../../api/types'
import { cardSummary } from '../agents/agentDisplay'

const term = 'text-xs font-semibold tracking-[0.04em] text-muted uppercase'
const value = 'm-0 text-sm'

export function AgentOverview({ agent }: { agent: Agent }) {
  return (
    <section aria-label="Overview" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <dl className="m-0 grid gap-x-8 gap-y-4 sm:grid-cols-[12rem_1fr]">
        <dt className={term}>Description</dt>
        <dd className={value}>{agent.description || '—'}</dd>
        <dt className={term}>Agent URL</dt>
        <dd className={`${value} font-mono text-[13px] break-all`}>{agent.base_url}</dd>
        <dt className={term}>A2A endpoint</dt>
        <dd className={`${value} font-mono text-[13px] break-all`}>{agent.upstream_url}</dd>
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
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
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
  )
}
