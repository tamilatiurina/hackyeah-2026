import { Link } from 'react-router'
import type { Agent } from '../../api/types'
import { pillClass } from '../../ui/classes'
import { LoadingRows, TableFrame } from '../../ui/Page'
import { STEP_CTA, agentPath, setupProgress } from '../agent/setupProgress'
import { ChevronRight } from '../agent/workspaceUi'

export interface AgentRow {
  agent: Agent
  /** Enabled, non-mandatory guardrails attached to the agent. */
  attached: number
  sessions: number
  events: number
}

const HEADERS = ['Agent', 'Status', 'Guardrails', 'Traffic']
const cell = 'px-5 py-4 align-middle'

export function AgentsTable({ rows, mandatoryCount }: { rows: readonly AgentRow[]; mandatoryCount: number }) {
  return (
    <TableFrame label="Agents table">
      <table className="w-full min-w-[820px] border-collapse text-left text-sm">
        <thead className="bg-[#F9F9F6]">
          <tr className="border-b border-line text-[11px] tracking-[0.08em] text-muted uppercase">
            {HEADERS.map((header) => (
              <th key={header} scope="col" className="px-5 py-3.5 font-semibold">
                {header}
              </th>
            ))}
            <th scope="col" className="px-5 py-3.5 text-right font-semibold">
              Next step
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ agent, attached, sessions, events }) => {
            const progress = setupProgress(agent, { attached })
            const next = progress.live ? null : progress.next
            return (
              <tr key={agent.id} className="group border-b border-line last:border-b-0 hover:bg-[#FAFAF7]">
                <td className={`${cell} max-w-[360px]`}>
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link to={agentPath(agent.id)} className="self-start font-semibold text-ink group-hover:text-teal-dark">
                      {agent.name}
                    </Link>
                    <span className="truncate font-mono text-xs text-muted">{agent.base_url}</span>
                  </div>
                </td>
                <td className={cell}>
                  <span className={`${pillClass} ${progress.live ? 'bg-teal-soft text-teal-dark' : 'bg-warn-bg text-warn-fg'}`}>
                    {progress.statusLabel}
                  </span>
                </td>
                <td className={`${cell} text-[13px] whitespace-nowrap`}>
                  {attached} attached · {mandatoryCount} mandatory
                </td>
                <td className={`${cell} text-[13px] whitespace-nowrap text-muted`}>
                  {progress.live ? `${sessions} ${sessions === 1 ? 'session' : 'sessions'} · ${events} events` : 'Not deployed'}
                </td>
                <td className={`${cell} text-right whitespace-nowrap`}>
                  {next ? (
                    <Link
                      to={agentPath(agent.id, next)}
                      aria-label={`${STEP_CTA[next]} for ${agent.name}`}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-teal/35 bg-teal-soft px-3 text-[13px] font-semibold text-teal-dark no-underline hover:bg-[#d3e8e2] hover:text-teal-dark"
                    >
                      {STEP_CTA[next]}
                      <ChevronRight size={14} />
                    </Link>
                  ) : (
                    <Link
                      to={agentPath(agent.id)}
                      aria-label={`Open ${agent.name}`}
                      className="inline-flex min-h-9 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink no-underline hover:bg-canvas hover:text-ink"
                    >
                      Open
                    </Link>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableFrame>
  )
}

export function AgentsTableSkeleton() {
  return <LoadingRows label="Loading agents" count={4} />
}
