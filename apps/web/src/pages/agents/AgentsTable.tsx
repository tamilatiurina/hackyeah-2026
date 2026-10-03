import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Agent } from '../../api/types'
import { cardSummary } from './agentDisplay'

const HEADERS = ['Agent', 'Description', 'Agent URL', 'Agent Card', 'Auth header']
const cell = 'px-4 py-3 align-middle'

function TableFrame({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <div
      role="region"
      aria-label="Agents table"
      aria-busy={busy}
      tabIndex={0}
      className="overflow-x-auto rounded-xl border border-line bg-surface"
    >
      <table className="w-full min-w-[880px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs tracking-[0.04em] text-muted uppercase">
            {HEADERS.map((header) => (
              <th key={header} scope="col" className="px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function AgentsTable({ agents, highlightId }: { agents: readonly Agent[]; highlightId: string | null }) {
  return (
    <TableFrame>
      {agents.map((agent) => {
        const highlighted = agent.id === highlightId
        return (
          <tr
            key={agent.id}
            data-highlight={highlighted}
            className={`border-b border-line transition-colors last:border-b-0 ${highlighted ? 'bg-teal-soft' : ''}`}
          >
            <td className={cell}>
              <Link to={`/agents/${agent.id}`} className="font-semibold">
                {agent.name}
              </Link>
            </td>
            <td className={`${cell} max-w-72 text-muted`}>{agent.description || '—'}</td>
            <td className={`${cell} font-mono text-[13px] break-all text-muted`}>{agent.base_url}</td>
            <td className={`${cell} whitespace-nowrap ${agent.agent_card ? '' : 'text-danger'}`}>
              {cardSummary(agent.agent_card)}
            </td>
            <td className={`${cell} ${agent.auth_header_name ? 'font-mono text-[13px]' : 'text-muted'}`}>
              {agent.auth_header_name ?? 'None'}
            </td>
          </tr>
        )
      })}
    </TableFrame>
  )
}

export function AgentsTableSkeleton() {
  return (
    <TableFrame busy>
      {[0, 1, 2, 3].map((row) => (
        <tr key={row} className="border-b border-line last:border-b-0">
          {HEADERS.map((header) => (
            <td key={header} className={cell}>
              <span className="block h-3.5 w-3/4 animate-pulse rounded bg-[#ECECE6]" />
            </td>
          ))}
        </tr>
      ))}
    </TableFrame>
  )
}
