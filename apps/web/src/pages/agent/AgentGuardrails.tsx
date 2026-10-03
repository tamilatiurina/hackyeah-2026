import { useEffect, useRef, useState } from 'react'
import {
  useAgentBindings,
  useAttachGuardrail,
  useDetachBinding,
  useEffectiveGuardrails,
  useReorderBindings,
  useUpdateBinding,
} from '../../api/bindings'
import { ApiError } from '../../api/client'
import { useGuardrails } from '../../api/guardrails'
import type { Agent, Binding, EffectiveGuardrail, Guardrail } from '../../api/types'
import { badgeClass, buttonSecondary, inputClass } from '../../ui/classes'
import { ACTION_LABELS, engineLabel, stageLabel } from '../guardrails/guardrailDisplay'

const ATTACH_UNAVAILABLE = "Attaching guardrails isn't available on this API yet."
const small = `${buttonSecondary} px-3 text-xs`
const sub = 'm-0 text-xs font-semibold tracking-[0.04em] text-muted uppercase'
const SOURCE_LABELS: Record<EffectiveGuardrail['source'], string> = {
  mandatory: 'Mandatory',
  agent: 'Agent',
  role: 'Role',
  user: 'User',
}

function Badges({ guardrail }: { guardrail: Guardrail }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className={`${badgeClass} bg-[#E6E9F5] text-[#2E3A6B]`}>{engineLabel(guardrail.engine)}</span>
      <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{stageLabel(guardrail.stages)}</span>
      <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{ACTION_LABELS[guardrail.action]}</span>
    </span>
  )
}

function EffectiveList({ label, entries }: { label: string; entries: EffectiveGuardrail[] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <h4 className="m-0 text-sm font-semibold">{label}</h4>
      <ol aria-label={label} className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm">
        {entries.map((e) => (
          <li key={e.guardrail.id}>
            <span data-name>{e.guardrail.name}</span>{' '}
            <span className="text-xs text-muted">{SOURCE_LABELS[e.source]}</span>
          </li>
        ))}
      </ol>
      {entries.length === 0 && <p className="m-0 text-sm text-muted">Nothing runs here.</p>}
    </div>
  )
}

/** FR-05/06: the agent's guardrail bindings (saved one action at a time) and what actually runs. */
export function AgentGuardrails({ agent }: { agent: Agent }) {
  const guardrails = useGuardrails()
  const bindings = useAgentBindings(agent.id)
  const effective = useEffectiveGuardrails(agent.id)
  const attach = useAttachGuardrail(agent.id)
  const updateBinding = useUpdateBinding(agent.id)
  const reorder = useReorderBindings(agent.id)
  const detach = useDetachBinding(agent.id)
  const busy = attach.isPending || updateBinding.isPending || reorder.isPending || detach.isPending

  const [pick, setPick] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  // Where keyboard focus goes after the next render: 'heading', or a button's aria-label.
  const pendingFocus = useRef<string | null>(null)

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target === 'heading') {
      headingRef.current?.focus()
      return
    }
    for (const button of sectionRef.current?.querySelectorAll<HTMLButtonElement>('button[aria-label]') ?? []) {
      if (button.getAttribute('aria-label') === target) button.focus()
    }
  })

  const library = guardrails.data ?? []
  const byId = new Map(library.map((g) => [g.id, g]))
  const mandatory = library.filter((g) => g.is_mandatory)
  const unsupported =
    bindings.error instanceof ApiError && (bindings.error.status === 404 || bindings.error.status === 405)
  const all = bindings.data ?? []
  // Mandatory guardrails need no binding; ignore any that exist.
  const visible = all.filter((b) => !byId.get(b.guardrail_id)?.is_mandatory)
  const attachable = library.filter((g) => g.enabled && !g.is_mandatory && !all.some((b) => b.guardrail_id === g.id))
  const nameOf = (b: Binding) => byId.get(b.guardrail_id)?.name ?? `Unknown guardrail (${b.guardrail_id})`

  const act = async (run: () => Promise<unknown>, done: { announce: string; focus?: string }) => {
    setError(null)
    setAnnouncement('')
    try {
      await run()
      if (done.focus) pendingFocus.current = done.focus
      setAnnouncement(done.announce)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const attachPicked = () => {
    const guardrail = byId.get(pick)
    if (!guardrail) return
    const orderIndex = all.length === 0 ? 0 : Math.max(...all.map((b) => b.order_index)) + 1
    setPick('')
    selectRef.current?.focus() // Attach is disabled again once the select resets
    void act(() => attach.mutateAsync({ guardrailId: guardrail.id, orderIndex }), {
      announce: `Attached ${guardrail.name}`,
    })
  }

  const move = (index: number, delta: number) => {
    const next = [...visible]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    const target = index + delta
    // At either end the pressed arrow becomes disabled, so focus the other one.
    const direction = target === 0 ? 'down' : target === next.length - 1 ? 'up' : delta < 0 ? 'up' : 'down'
    const name = nameOf(visible[index])
    void act(() => reorder.mutateAsync(next), { announce: `Moved ${name}`, focus: `Move ${name} ${direction}` })
  }

  return (
    <section
      ref={sectionRef}
      aria-labelledby="agent-guardrails-title"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6"
    >
      <h2 id="agent-guardrails-title" className="m-0 text-lg font-semibold">
        Guardrails
      </h2>
      <p role="status" className="sr-only">
        {announcement}
      </p>

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

          {unsupported ? (
            <p className="m-0 text-sm text-muted">{ATTACH_UNAVAILABLE}</p>
          ) : bindings.isError ? (
            <p role="alert" className="m-0 text-sm">
              Couldn't load this agent's guardrails.
            </p>
          ) : bindings.isPending ? (
            <p className="m-0 text-sm text-muted">Loading attached guardrails…</p>
          ) : (
            <div className="flex flex-col gap-3">
              <h3 id="attached-guardrails" ref={headingRef} tabIndex={-1} className={sub}>
                Attached to this agent
              </h3>
              {visible.length === 0 ? (
                <p className="m-0 text-sm text-muted">No guardrails attached. Only the mandatory ones run.</p>
              ) : (
                <ol aria-labelledby="attached-guardrails" className="m-0 flex list-none flex-col gap-2 p-0">
                  {visible.map((b, index) => {
                    const g = byId.get(b.guardrail_id)
                    const name = nameOf(b)
                    return (
                      <li
                        key={b.id}
                        className={`flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2 ${
                          b.enabled ? '' : 'opacity-60'
                        }`}
                      >
                        <span className="w-6 text-sm text-muted">{index + 1}.</span>
                        <span data-name className="text-sm font-semibold">
                          {name}
                        </span>
                        {g && <Badges guardrail={g} />}
                        {!b.enabled && (
                          <span className={`${badgeClass} bg-warn-bg text-warn-fg`}>Paused</span>
                        )}
                        <span className="ml-auto flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={small}
                            disabled={busy || index === 0}
                            aria-label={`Move ${name} up`}
                            onClick={() => move(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className={small}
                            disabled={busy || index === visible.length - 1}
                            aria-label={`Move ${name} down`}
                            onClick={() => move(index, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className={small}
                            disabled={busy}
                            aria-label={`${b.enabled ? 'Pause' : 'Resume'} ${name}`}
                            onClick={() =>
                              void act(() => updateBinding.mutateAsync({ id: b.id, changes: { enabled: !b.enabled } }), {
                                announce: `${b.enabled ? 'Paused' : 'Resumed'} ${name}`,
                                focus: `${b.enabled ? 'Resume' : 'Pause'} ${name}`,
                              })
                            }
                          >
                            {b.enabled ? 'Pause' : 'Resume'}
                          </button>
                          <button
                            type="button"
                            className={small}
                            disabled={busy}
                            aria-label={`Remove ${name}`}
                            onClick={() =>
                              void act(() => detach.mutateAsync(b.id), { announce: `Removed ${name}`, focus: 'heading' })
                            }
                          >
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
                  <select
                    id="attach-guardrail"
                    ref={selectRef}
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Choose a guardrail…</option>
                    {attachable.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className={buttonSecondary} disabled={!pick || busy} onClick={attachPicked}>
                  Attach
                </button>
              </div>

              {error && (
                <p role="alert" className="m-0 text-sm text-danger">
                  {error}
                </p>
              )}
            </div>
          )}

          {effective.data && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <h3 className={sub}>Runs in this order</h3>
              <div className="flex flex-col gap-4 sm:flex-row">
                <EffectiveList label="Input checks" entries={effective.data.input} />
                <EffectiveList label="Output checks" entries={effective.data.output} />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
