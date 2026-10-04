import type { PlannedProbe, ProbeResult, RunResult, ScanCategory, ScanVerdict, StaticCheck } from '../../api/security'
import { badgeClass } from '../../ui/classes'

const VERDICTS: Record<ScanVerdict, { label: string; className: string }> = {
  vulnerable: { label: 'Vulnerable', className: 'bg-[#FBE7E2] text-danger' },
  defended: { label: 'Defended', className: 'bg-teal-soft text-teal-dark' },
  inconclusive: { label: 'Inconclusive', className: 'bg-[#F0F0EB] text-[#30343B]' },
}

const CHECKS: Record<StaticCheck['status'], { label: string; className: string }> = {
  passed: { label: 'Passed', className: 'bg-teal-soft text-teal-dark' },
  warning: { label: 'Warning', className: 'bg-warn-bg text-warn-fg' },
  not_testable: { label: 'Not testable over chat', className: 'bg-[#F0F0EB] text-[#30343B]' },
}

function Verdict({ run, label }: { run: RunResult | undefined; label: string }) {
  if (!run) {
    return <span className={`${badgeClass} bg-canvas text-muted`}>{label}: running…</span>
  }
  const v = VERDICTS[run.verdict]
  return <span className={`${badgeClass} ${v.className}`}>{`${label}: ${v.label}`}</span>
}

function RunDetail({ label, run }: { label: string; run: RunResult }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <h5 className="m-0 text-xs font-semibold text-muted uppercase">{label}</h5>
      <p className="m-0 text-sm">{run.reason}</p>
      {run.stoppedBy && <p className="m-0 text-xs text-muted">Guardrail: {run.stoppedBy}</p>}
      {run.evidence && (
        <pre className="m-0 max-h-40 overflow-auto rounded-md bg-canvas p-2 text-xs break-words whitespace-pre-wrap">
          {run.evidence}
        </pre>
      )}
    </div>
  )
}

function ProbeRow({ title, result }: { title: string; result: ProbeResult | undefined }) {
  return (
    <li className="rounded-lg border border-line">
      <details className="group">
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 marker:text-muted">
          <span className="mr-auto text-sm font-semibold">{title}</span>
          <Verdict label="Unguarded" run={result?.unguarded} />
          <Verdict label="Guarded" run={result?.guarded} />
        </summary>
        {result && (
          <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
            <div className="flex flex-col gap-1">
              <h5 className="m-0 text-xs font-semibold text-muted uppercase">Attack</h5>
              <pre className="m-0 rounded-md bg-canvas p-2 text-xs break-words whitespace-pre-wrap">{result.attack}</pre>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <RunDetail label="Straight to the agent" run={result.unguarded} />
              <RunDetail label="Through the hub" run={result.guarded} />
            </div>
          </div>
        )}
      </details>
    </li>
  )
}

interface ScorecardProps {
  categories: ScanCategory[]
  staticChecks: StaticCheck[]
  results: ProbeResult[]
  /** Probe titles per category while a scan runs, so rows show before their results arrive. */
  pending?: PlannedProbe[]
}

/** One row per OWASP LLM Top 10 (2025) category. */
export function Scorecard({ categories, staticChecks, results, pending = [] }: ScorecardProps) {
  const byId = new Map(results.map((r) => [r.probeId, r]))
  return (
    <ol aria-label="OWASP LLM Top 10" className="m-0 flex list-none flex-col gap-3 p-0">
      {categories.map((category) => {
        const probes = [
          ...results.filter((r) => r.category === category.id),
          ...pending.filter((p) => p.category === category.id && !byId.has(p.probeId)),
        ]
        const checks = staticChecks.filter((c) => c.category === category.id)
        return (
          <li key={category.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
            <h3 className="m-0 flex flex-wrap items-baseline gap-2 text-sm font-semibold">
              <span className="font-mono text-xs text-muted">{category.id}</span>
              {category.name}
            </h3>
            {probes.length > 0 && (
              <ul aria-label={`${category.id} attacks`} className="m-0 flex list-none flex-col gap-2 p-0">
                {probes.map((p) => (
                  <ProbeRow key={p.probeId} title={p.title} result={byId.get(p.probeId)} />
                ))}
              </ul>
            )}
            {checks.length > 0 && (
              <ul aria-label={`${category.id} checks`} className="m-0 flex list-none flex-col gap-2 p-0">
                {checks.map((c) => (
                  <li key={c.title} className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-2">
                    <span className="mr-auto flex flex-col">
                      <span className="text-sm font-semibold">{c.title}</span>
                      <span className="text-xs text-muted">{c.detail}</span>
                    </span>
                    <span className={`${badgeClass} ${CHECKS[c.status].className}`}>{CHECKS[c.status].label}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
