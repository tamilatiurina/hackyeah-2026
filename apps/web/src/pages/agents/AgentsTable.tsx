import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Agent } from '../../api/types'
import { badgeClass, pillClass } from '../../ui/classes'
import { endpointLabel, statusOf, type Tone } from './agentDisplay'

const HEADERS = ['Agent', 'Mode', 'Group', 'Endpoint', 'Rules', 'Status', 'Owner']

const TONE: Record<Tone, string> = {
  ok: 'bg-teal-soft text-teal-dark',
  neutral: 'bg-[#F0F0EB] text-[#30343B]',
  warn: 'bg-warn-bg text-warn-fg',
}

const MODE: Record<Agent['mode'], { label: string; className: string }> = {
  proxy: { label: 'Proxy', className: 'bg-[#F0F0EB] text-[#30343B]' },
  runtime: { label: 'Runtime', className: 'bg-[#E6E9F5] text-[#2E3A6B]' },
}

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

interface AgentsTableProps {
  agents: readonly Agent[]
  groupName: (groupId: string) => string
  highlightId: string | null
}

export function AgentsTable({ agents, groupName, highlightId }: AgentsTableProps) {
  // Read once per mount: "last seen N min ago" doesn't need to tick while the page is open.
  const [now] = useState(Date.now)
  return (
    <TableFrame>
      {agents.map((agent) => {
        const status = statusOf(agent)
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
            <td className={cell}>
              <span className={`${badgeClass} ${MODE[agent.mode].className}`}>{MODE[agent.mode].label}</span>
            </td>
            <td className={cell}>{groupName(agent.groupId)}</td>
            <td className={`${cell} text-muted ${agent.mode === 'proxy' ? 'font-mono text-[13px] break-all' : ''}`}>
              {endpointLabel(agent, now)}
            </td>
            <td className={cell}>{agent.ruleCount}</td>
            <td className={cell}>
              <span className={`${pillClass} ${TONE[status.tone]}`}>{status.label}</span>
            </td>
            <td className={`${cell} font-mono text-[13px] text-muted`}>{agent.owner}</td>
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
