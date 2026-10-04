import { useState } from 'react'
import { Link } from 'react-router'
import { useAgents } from '../../api/agents'
import {
  useRunSecurityScan,
  useSecurityScan,
  useSecurityScans,
  type ProbeResult,
  type ScanListItem,
} from '../../api/security'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { Scorecard } from './Scorecard'

function count(results: ProbeResult[], run: 'unguarded' | 'guarded') {
  return results.filter((r) => r[run].verdict === 'vulnerable').length
}

function Headline({ results, total }: { results: ProbeResult[]; total: number }) {
  const unguarded = count(results, 'unguarded')
  const guarded = count(results, 'guarded')
  const stopped = results.filter((r) => r.unguarded.verdict === 'vulnerable' && r.guarded.verdict === 'defended').length
  const stats = [
    { label: 'Attacks that worked without the hub', value: `${unguarded} / ${total}`, tone: 'text-danger' },
    { label: 'Attacks that worked with guardrails', value: `${guarded} / ${total}`, tone: guarded ? 'text-danger' : 'text-teal-dark' },
    { label: 'Stopped by guardrails', value: String(stopped), tone: 'text-teal-dark' },
  ]
  return (
    <dl aria-label="Scan score" className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4">
          <dt className="text-xs font-semibold text-muted">{s.label}</dt>
          <dd className={`m-0 text-2xl font-semibold ${s.tone}`}>{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function History({ scans, selected, onSelect }: { scans: ScanListItem[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <section aria-labelledby="scan-history" className="flex flex-col gap-2">
      <h2 id="scan-history" className="m-0 text-base font-semibold">
        Past scans
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {scans.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              aria-pressed={selected === s.id}
              onClick={() => onSelect(s.id)}
              className={`${buttonSecondary} flex w-full flex-wrap justify-between gap-2 text-left aria-pressed:border-teal`}
            >
              <span>{new Date(s.createdAt).toLocaleString()}</span>
              <span className="text-muted">
                {s.summary.unguarded.vulnerable} → {s.summary.guarded.vulnerable} of {s.summary.total} attacks worked
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** SEC-01: OWASP LLM Top 10 (2025) attacks against an agent, without and with its guardrails. */
export function SecurityPage() {
  const agents = useAgents()
  const [pickedAgentId, setPickedAgentId] = useState('')
  const agentId = pickedAgentId || agents.data?.[0]?.id || ''
  const { live, run, reset } = useRunSecurityScan()
  const history = useSecurityScans(agentId)
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null)
  const saved = useSecurityScan(live.running || live.scan ? null : selectedScanId)

  const showingLive = live.running || live.results.length > 0 || live.error !== null
  const view = showingLive
    ? { categories: live.categories, staticChecks: live.staticChecks, results: live.results, total: live.total }
    : saved.data
      ? {
          categories: saved.data.categories,
          staticChecks: saved.data.staticChecks,
          results: saved.data.results,
          total: saved.data.summary.total,
        }
      : null

  const pickAgent = (id: string) => {
    setPickedAgentId(id)
    setSelectedScanId(null)
    reset()
  }
  const showSaved = (id: string) => {
    reset()
    setSelectedScanId(id)
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-semibold">Security scan</h1>
        <p className="m-0 text-sm text-muted">
          Runs the OWASP Top 10 for LLM Applications (2025) attacks against an agent twice: straight to the agent, then
          through its guardrails.
        </p>
      </header>

      {agents.isPending ? (
        <p className="m-0 text-sm text-muted">Loading agents…</p>
      ) : agents.isError ? (
        <p role="alert" className="m-0 text-sm">
          Couldn't load agents.
        </p>
      ) : !agentId ? (
        <p className="m-0 text-sm text-muted">
          No agents yet. <Link to="/agents">Register one</Link> to scan it.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-60 flex-col gap-1.5">
              <label htmlFor="scan-agent" className="text-[13px] font-semibold text-[#30343B]">
                Agent
              </label>
              <select
                id="scan-agent"
                value={agentId}
                disabled={live.running}
                onChange={(e) => pickAgent(e.target.value)}
                className={inputClass}
              >
                {agents.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className={buttonPrimary} disabled={live.running} onClick={() => void run(agentId)}>
              {live.running ? 'Scanning…' : 'Run scan'}
            </button>
          </div>

          <p role="status" className="m-0 text-sm text-muted">
            {live.running
              ? `Attacking… ${live.results.length} of ${live.total || '…'} probes done`
              : live.scan
                ? `Scan finished: ${live.scan.summary.total} probes, each sent twice.`
                : ''}
          </p>
          {!live.judge && showingLive && (
            <p className="m-0 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">
              No LLM judge on this API, so attacks only a judge can grade are marked inconclusive.
            </p>
          )}
          {live.warning && <p className="m-0 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">{live.warning}</p>}
          {live.error && (
            <p role="alert" className="m-0 text-sm text-danger">
              {live.error}
            </p>
          )}

          {view && view.results.length > 0 && <Headline results={view.results} total={view.total} />}
          {view && view.categories.length > 0 && (
            <Scorecard
              categories={view.categories}
              staticChecks={view.staticChecks}
              results={view.results}
              pending={showingLive ? live.probes : []}
            />
          )}
          {!view && !saved.isFetching && (
            <p className="m-0 text-sm text-muted">Run a scan, or open a past one.</p>
          )}

          {history.data && history.data.length > 0 && (
            <History scans={history.data} selected={showingLive ? null : selectedScanId} onSelect={showSaved} />
          )}
        </>
      )}
    </div>
  )
}
