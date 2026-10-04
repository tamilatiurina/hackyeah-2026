import { Link } from 'react-router'
import type { SessionSummary, SessionsStats } from '../../api/playground'
import { badgeClass, buttonSecondary } from '../../ui/classes'
import {
  formatAgo,
  formatCost,
  formatDuration,
  formatTokenSplit,
  formatTokens,
  projectLabel,
} from './sessionFormat'

const card = 'flex flex-col gap-3 rounded-xl border border-line bg-surface p-5'

export function StatsBand({ stats }: { stats: SessionsStats }) {
  const items: Array<{ label: string; value: string }> = [
    { label: 'Sessions', value: String(stats.sessionCount) },
    { label: 'Total cost', value: formatCost(stats.totalCostUsd) },
    { label: 'Avg cost / session', value: formatCost(stats.avgCostUsd) },
    { label: 'Total tokens', value: formatTokenSplit(stats.totalTokens, stats.totalCacheTokens) },
    { label: 'Tool calls', value: formatTokens(stats.totalToolCalls) },
    { label: 'Avg duration', value: formatDuration(stats.avgDurationMs) },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs text-muted">{item.label}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{item.value}</div>
        </div>
      ))}
    </div>
  )
}

export function ProjectChips({ stats }: { stats: SessionsStats }) {
  const entries = Object.entries(stats.projects)
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-muted">Projects:</span>
      {entries.map(([dir, count]) => (
        <span key={dir} className={`${badgeClass} bg-[#E6E9F5] text-[#2E3A6B]`}>
          {projectLabel(dir)} · {count}
        </span>
      ))}
    </div>
  )
}

export function SessionCard({ session }: { session: SessionSummary }) {
  return (
    <article aria-label={session.title || session.id} className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">{formatAgo(session.timestamp)}</span>
        {session.fromPlayground && (
          <span className={`${badgeClass} bg-teal-soft text-teal-dark`}>
            <Link to="/playground" className="font-semibold">
              Playground
            </Link>
          </span>
        )}
        {session.model && (
          <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{session.model}</span>
        )}
        <span className="ml-auto text-sm font-semibold tabular-nums">{formatCost(session.costUsd)}</span>
      </div>
      <p className="m-0 line-clamp-2 min-w-0 break-words text-sm">{session.title || session.id}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>{session.messages} messages</span>
        <span>{session.toolCalls} tool calls</span>
        <span>{formatTokenSplit(session.totalTokens, session.cacheTokens)} tokens</span>
        <span>{formatDuration(session.durationMs)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <code className="min-w-0 truncate font-mono text-[11px] text-muted">{projectLabel(session.projectDir)}</code>
        <Link to="/playground" className="shrink-0" title="Try it yourself on the Playground">
          <button type="button" className={`${buttonSecondary} min-h-9 px-2.5 text-xs`}>
            Run yours
          </button>
        </Link>
      </div>
    </article>
  )
}
