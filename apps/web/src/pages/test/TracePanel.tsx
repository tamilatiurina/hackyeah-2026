import type { Reply, TraceEntry } from '../../api/a2a'
import { badgeClass } from '../../ui/classes'

const STAGES: Record<TraceEntry['stage'], string> = { input: 'Input', output: 'Output' }
const VERDICTS: Record<TraceEntry['verdict'], string> = {
  pass: 'Pass',
  block: 'Block',
  redact: 'Redact',
  warn: 'Warn',
  skipped: 'Skipped',
  error: 'Error',
}
const cell = 'px-2 py-1.5 align-top'

/** FR-11: what the guardrails did for one reply, plus usage and limits. */
export function TracePanel({ reply }: { reply: Reply | null }) {
  return (
    <section aria-label="Trace" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <h2 className="m-0 text-base font-semibold">Trace</h2>
      {!reply ? (
        <p className="m-0 text-sm text-muted">Send a message to see what the guardrails did.</p>
      ) : (
        <>
          {reply.trace.length === 0 ? (
            <p className="m-0 text-sm text-muted">No guardrails ran for this reply.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    {['Guardrail', 'Stage', 'Verdict', 'Reason', 'Latency'].map((h) => (
                      <th key={h} scope="col" className={`${cell} font-semibold`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reply.trace.map((t, i) => (
                    <tr key={`${t.guardrailId}-${t.stage}-${i}`} className="border-b border-line last:border-b-0">
                      <td className={`${cell} font-semibold`}>
                        {t.guardrailName}
                        {t.simulated && (
                          <span className={`${badgeClass} ml-1.5 bg-[#F0F0EB] text-[#30343B]`}>Simulated</span>
                        )}
                      </td>
                      <td className={cell}>{STAGES[t.stage]}</td>
                      <td className={cell}>{VERDICTS[t.verdict]}</td>
                      <td className={`${cell} text-muted`}>{t.reason}</td>
                      <td className={`${cell} whitespace-nowrap`}>{t.latencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {reply.usage && (
            <p className="m-0 flex flex-wrap gap-x-3 text-sm">
              <span className="text-muted">Tokens</span>
              <span>
                {reply.usage.inputTokens} in · {reply.usage.outputTokens} out
              </span>
              {reply.usage.costUsd !== undefined && <span>${reply.usage.costUsd.toFixed(4)}</span>}
            </p>
          )}

          {reply.limits.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {reply.limits.map((l) => (
                <li key={l.name} className="flex flex-col gap-1 text-sm">
                  <span>
                    {l.name}: {l.used} / {l.max}
                    {l.unit ? ` ${l.unit}` : ''}
                  </span>
                  <progress value={Math.min(l.used, l.max)} max={l.max} aria-label={l.name} className="h-2 w-full" />
                </li>
              ))}
            </ul>
          )}

          {reply.scores.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
              {reply.scores.map((s) => (
                <li key={s.name}>
                  {s.name}: {s.score}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
