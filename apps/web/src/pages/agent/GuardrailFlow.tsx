import type { EffectiveGuardrail, GuardrailAction } from '../../api/types'
import { ACTION_LABELS, engineLabel } from '../guardrails/guardrailDisplay'

const SOURCE_LABELS: Record<EffectiveGuardrail['source'], string> = {
  mandatory: 'Mandatory',
  agent: 'Agent',
  role: 'Role',
  user: 'User',
}

// Left edge and badge per action, so a blocking check stands out in the flow.
const ACTION_STYLES: Record<GuardrailAction, { edge: string; badge: string }> = {
  block: { edge: 'border-l-danger', badge: 'bg-[#F7E3DF] text-danger' },
  redact: { edge: 'border-l-teal', badge: 'bg-teal-soft text-teal-dark' },
  warn: { edge: 'border-l-amber', badge: 'bg-warn-bg text-warn-fg' },
}

/** → between steps on wide screens, ↓ when the flow stacks on narrow ones. */
function Arrow({ down = false }: { down?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center text-muted ${down ? '' : 'lg:-rotate-90'}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 4v15M6 13l6 6 6-6" />
      </svg>
    </span>
  )
}

function Endpoint({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center rounded-full bg-sidebar px-4 py-2 self-center text-center text-white">
      <span className="text-sm font-semibold">{label}</span>
      {detail && <span className="max-w-40 truncate text-xs text-sidebar-muted">{detail}</span>}
    </div>
  )
}

function Lock() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function Stage({ label, entries }: { label: string; entries: EffectiveGuardrail[] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-dashed border-line-strong p-3">
      <h4 className="m-0 text-xs font-semibold tracking-[0.04em] text-muted uppercase">{label}</h4>
      <ol aria-label={label} className="m-0 flex list-none flex-col p-0">
          {entries.map((e, index) => {
            const style = ACTION_STYLES[e.guardrail.action]
            return (
              <li key={e.guardrail.id} className="flex flex-col items-stretch">
                {index > 0 && <Arrow down />}
                <div
                  className={`flex items-start gap-2.5 rounded-lg border border-l-4 border-line bg-surface px-3 py-2 ${style.edge}`}
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-muted">
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span data-name className="text-sm font-semibold break-words">
                      {e.guardrail.name}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {e.source === 'mandatory' && <Lock />}
                      <span>{SOURCE_LABELS[e.source]}</span>
                      <span aria-hidden="true">·</span>
                      <span>{engineLabel(e.guardrail.engine)}</span>
                      <span className={`rounded-md px-1.5 py-px font-semibold ${style.badge}`}>
                        {ACTION_LABELS[e.guardrail.action]}
                      </span>
                    </span>
                  </span>
                </div>
              </li>
            )
          })}
      </ol>
      {entries.length === 0 && <p className="m-0 text-sm text-muted">Nothing runs here.</p>}
    </div>
  )
}

interface GuardrailFlowProps {
  agentName: string
  input: EffectiveGuardrail[]
  output: EffectiveGuardrail[]
}

/** The order a message goes through: input checks, the agent, then output checks on its reply. */
export function GuardrailFlow({ agentName, input, output }: GuardrailFlowProps) {
  return (
    <div role="group" aria-label="Guardrail order" className="flex flex-col items-stretch gap-2 lg:flex-row">
      <Endpoint label="Caller" />
      <Arrow />
      <Stage label="Input checks" entries={input} />
      <Arrow />
      <Endpoint label="Agent" detail={agentName} />
      <Arrow />
      <Stage label="Output checks" entries={output} />
      <Arrow />
      <Endpoint label="Reply" />
    </div>
  )
}
