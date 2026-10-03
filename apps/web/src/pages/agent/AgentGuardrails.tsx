import { useMemo, useState } from 'react'
import { useUpdateAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import { useGuardrails } from '../../api/guardrails'
import type { Agent, Guardrail } from '../../api/types'
import { badgeClass, buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { ACTION_LABELS, engineLabel, stageLabel } from '../guardrails/guardrailDisplay'

const ATTACH_UNAVAILABLE = "Attaching guardrails isn't available on this API yet."
const small = `${buttonSecondary} px-3 text-xs`
const sub = 'm-0 text-xs font-semibold tracking-[0.04em] text-muted uppercase'

function Badges({ guardrail }: { guardrail: Guardrail }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className={`${badgeClass} bg-[#E6E9F5] text-[#2E3A6B]`}>{engineLabel(guardrail.engine)}</span>
      <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{stageLabel(guardrail.stages)}</span>
      <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{ACTION_LABELS[guardrail.action]}</span>
    </span>
  )
}

export function AgentGuardrails({ agent }: { agent: Agent }) {
  const guardrails = useGuardrails()
  const update = useUpdateAgent(agent.id)
  const supported = agent.attached_rules !== undefined
  const rules = useMemo(
    () => [...(agent.attached_rules ?? [])].sort((a, b) => a.order_index - b.order_index),
    [agent.attached_rules],
  )
  const savedIds = useMemo(() => rules.filter((r) => r.rule_type === 'guardrail').map((r) => r.rule_id), [rules])
  const [draft, setDraft] = useState<string[] | null>(null) // null = no local changes
  const [pick, setPick] = useState('')
  const ids = draft ?? savedIds
  const dirty = draft !== null && draft.join('\n') !== savedIds.join('\n')

  const library = guardrails.data ?? []
  const byId = new Map(library.map((g) => [g.id, g]))
  const mandatory = library.filter((g) => g.mandatory)
  const attachable = library.filter((g) => g.enabled && !g.mandatory && !ids.includes(g.id))

  const edit = (next: string[]) => {
    update.reset()
    setDraft(next)
  }
  const move = (index: number, delta: number) => {
    const next = [...ids]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    edit(next)
  }
  const save = () =>
    update.mutate(
      {
        attached_rules: [
          ...ids.map((rule_id) => ({ rule_id, rule_type: 'guardrail' as const })),
          ...rules.filter((r) => r.rule_type === 'policy').map(({ rule_id, rule_type }) => ({ rule_id, rule_type })),
        ],
      },
      { onSuccess: () => setDraft(null) },
    )

  const saveError =
    update.error instanceof ApiError && update.error.status === 405 ? ATTACH_UNAVAILABLE : update.error?.message

  return (
    <section aria-labelledby="agent-guardrails-title" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
      <h2 id="agent-guardrails-title" className="m-0 text-lg font-semibold">
        Guardrails
      </h2>

      {guardrails.isError ? (
        <p role="alert" className="m-0 text-sm">
          Couldn't load guardrails.
        </p>
      ) : guardrails.isPending ? (
        <p className="m-0 text-sm text-muted">Loading guardrails…</p>
      ) : (
        <>
          {mandatory.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 id="always-applied" className={sub}>
                Always applied
              </h3>
              <ul aria-labelledby="always-applied" className="m-0 flex list-none flex-col gap-2 p-0">
                {mandatory.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-canvas px-3 py-2.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="5" y="11" width="14" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                    <span className="text-sm font-semibold">{g.name}</span>
                    <Badges guardrail={g} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!supported ? (
            <p className="m-0 text-sm text-muted">{ATTACH_UNAVAILABLE}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <h3 id="attached-guardrails" className={sub}>
                Attached guardrails
              </h3>
              {ids.length === 0 ? (
                <p className="m-0 text-sm text-muted">No guardrails attached. Only the mandatory ones run.</p>
              ) : (
                <ol aria-labelledby="attached-guardrails" className="m-0 flex list-none flex-col gap-2 p-0">
                  {ids.map((id, index) => {
                    const g = byId.get(id)
                    const name = g?.name ?? `Unknown guardrail (${id})`
                    return (
                      <li key={id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
                        <span className="w-6 text-sm text-muted">{index + 1}.</span>
                        <span data-name className="text-sm font-semibold">
                          {name}
                        </span>
                        {g && <Badges guardrail={g} />}
                        <span className="ml-auto flex gap-2">
                          <button type="button" className={small} disabled={index === 0} aria-label={`Move ${name} up`} onClick={() => move(index, -1)}>
                            ↑
                          </button>
                          <button
                            type="button"
                            className={small}
                            disabled={index === ids.length - 1}
                            aria-label={`Move ${name} down`}
                            onClick={() => move(index, 1)}
                          >
                            ↓
                          </button>
                          <button type="button" className={small} aria-label={`Remove ${name}`} onClick={() => edit(ids.filter((x) => x !== id))}>
                            Remove
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-60 flex-col gap-1.5">
                  <label htmlFor="attach-guardrail" className="text-[13px] font-semibold text-[#30343B]">
                    Attach guardrail
                  </label>
                  <select id="attach-guardrail" value={pick} onChange={(e) => setPick(e.target.value)} className={inputClass}>
                    <option value="">Choose a guardrail…</option>
                    {attachable.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={!pick}
                  onClick={() => {
                    edit([...ids, pick])
                    setPick('')
                  }}
                >
                  Attach
                </button>
              </div>

              {(dirty || saveError) && (
                <div className="flex flex-wrap items-center gap-3">
                  {dirty && <span className="text-sm text-warn-fg">Unsaved changes</span>}
                  {saveError && (
                    <span role="alert" className="text-sm text-danger">
                      {saveError}
                    </span>
                  )}
                  <span className="ml-auto flex gap-2">
                    <button
                      type="button"
                      className={buttonSecondary}
                      onClick={() => {
                        setDraft(null)
                        update.reset()
                      }}
                    >
                      Discard
                    </button>
                    <button type="button" className={buttonPrimary} disabled={!dirty || update.isPending} onClick={save}>
                      Save guardrails
                    </button>
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
