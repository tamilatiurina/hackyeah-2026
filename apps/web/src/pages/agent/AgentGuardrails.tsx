import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
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
import type { Agent, Binding, Guardrail } from '../../api/types'
import { badgeClass } from '../../ui/classes'
import { useToast } from '../../ui/toastContext'
import { ACTION_LABELS, engineLabel, stageLabel } from '../guardrails/guardrailDisplay'
import { GuardrailFlow } from './GuardrailFlow'
import { ActionBadge, ChevronRight, Lock, sectionCard, sectionText, sectionTitle, smallButton, textLink } from './workspaceUi'

const ATTACH_UNAVAILABLE = "Attaching guardrails isn't available on this API yet."
const small = smallButton
const sub = 'm-0 text-xs font-semibold tracking-[0.04em] text-muted uppercase'

function Badges({ guardrail }: { guardrail: Guardrail }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className={`${badgeClass} bg-[#E6E9F5] text-[#2E3A6B]`}>{engineLabel(guardrail.engine)}</span>
      <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{stageLabel(guardrail.stages)}</span>
      <ActionBadge action={guardrail.action}>{ACTION_LABELS[guardrail.action]}</ActionBadge>
    </span>
  )
}

/** Setup step 2 (FR-05/06): the mandatory guardrails, the ones attached to this agent (saved one
 * action at a time), the library to attach more from, and the order they run in. */
export function AgentGuardrails({ agent }: { agent: Agent }) {
  const guardrails = useGuardrails()
  const bindings = useAgentBindings(agent.id)
  const effective = useEffectiveGuardrails(agent.id)
  const attach = useAttachGuardrail(agent.id)
  const updateBinding = useUpdateBinding(agent.id)
  const reorder = useReorderBindings(agent.id)
  const detach = useDetachBinding(agent.id)
  const busy = attach.isPending || updateBinding.isPending || reorder.isPending || detach.isPending

  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const sectionRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
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
    try {
      await run()
      if (done.focus) pendingFocus.current = done.focus
      toast(`${done.announce}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const attachGuardrail = (guardrail: Guardrail) => {
    const orderIndex = all.length === 0 ? 0 : Math.max(...all.map((b) => b.order_index)) + 1
    // The card goes away once attached, so focus moves to the list heading.
    void act(() => attach.mutateAsync({ guardrailId: guardrail.id, orderIndex }), {
      announce: `Attached ${guardrail.name}`,
      focus: 'heading',
    })
  }
  const enabledCount = visible.filter((b) => b.enabled).length

  const move = (index: number, delta: number) => {
    const next = [...visible]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    const target = index + delta
    // At either end the pressed arrow becomes disabled, so focus the other one.
    const direction = target === 0 ? 'down' : target === next.length - 1 ? 'up' : delta < 0 ? 'up' : 'down'
    const name = nameOf(visible[index])
    void act(() => reorder.mutateAsync(next), { announce: `Moved ${name}`, focus: `Move ${name} ${direction}` })
  }

  const retry = (what: string, onRetry: () => void) => (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-canvas p-3">
      <p className="m-0 text-sm">Couldn't load {what}.</p>
      <button type="button" className={small} onClick={onRetry}>
        Retry
      </button>
    </div>
  )

  if (guardrails.isError) {
    return <section className={sectionCard}>{retry('guardrails', () => void guardrails.refetch())}</section>
  }
  if (guardrails.isPending) {
    return (
      <section className={sectionCard}>
        <p className="m-0 text-sm text-muted">Loading guardrails…</p>
      </section>
    )
  }

  return (
    <div ref={sectionRef} className="flex flex-col gap-6">
      <section aria-labelledby="agent-guardrails-title" className={sectionCard}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="agent-guardrails-title" className={sectionTitle}>
              Guardrails on {agent.name}
            </h2>
            <p className={sectionText}>
              Checks run on every call, before the agent sees the request and before the caller sees the reply. Changes
              save as you make them.
            </p>
          </div>
          <span className="text-[13px] font-semibold whitespace-nowrap text-muted">
            {mandatory.length} mandatory · {enabledCount} attached
          </span>
        </div>

        {mandatory.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 id="always-applied" className={sub}>
              Always applied
            </h3>
            <ul aria-labelledby="always-applied" className="m-0 flex list-none flex-col gap-1.5 p-0">
              {mandatory.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-canvas px-3 py-2.5">
                  <Lock />
                  <span className="text-sm font-semibold">{g.name}</span>
                  <Badges guardrail={g} />
                  <span className="ml-auto text-xs text-muted">Mandatory on all your agents</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {unsupported ? (
          <p className="m-0 text-sm text-muted">{ATTACH_UNAVAILABLE}</p>
        ) : bindings.isError ? (
          retry("this agent's guardrails", () => void bindings.refetch())
        ) : bindings.isPending ? (
          <p className="m-0 text-sm text-muted">Loading attached guardrails…</p>
        ) : (
          <div className="flex flex-col gap-2">
            <h3 id="attached-guardrails" ref={headingRef} tabIndex={-1} className={sub}>
              Attached to this agent
            </h3>
            {visible.length === 0 ? (
              <p className="m-0 rounded-lg border border-dashed border-line-strong px-3 py-3.5 text-sm text-muted">
                No guardrails attached. Only the mandatory ones run. Pick from the library below.
              </p>
            ) : (
              <ol aria-labelledby="attached-guardrails" className="m-0 flex list-none flex-col gap-1.5 p-0">
                {visible.map((b, index) => {
                  const g = byId.get(b.guardrail_id)
                  const name = nameOf(b)
                  return (
                    <li
                      key={b.id}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line py-2 pr-2 pl-3 ${
                        b.enabled ? '' : 'opacity-60'
                      }`}
                    >
                      <span className="w-5 text-sm text-muted">{index + 1}.</span>
                      <span data-name className="text-sm font-semibold">
                        {name}
                      </span>
                      {g && <Badges guardrail={g} />}
                      {!b.enabled && <span className={`${badgeClass} bg-warn-bg text-warn-fg`}>Paused</span>}
                      <span className="ml-auto flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className={`${small} min-w-9`}
                          disabled={busy || index === 0}
                          aria-label={`Move ${name} up`}
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={`${small} min-w-9`}
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
            {error && (
              <p role="alert" className="m-0 text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </section>

      {!unsupported && bindings.isSuccess && (
        <section aria-labelledby="guardrail-library-title" className={sectionCard}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="guardrail-library-title" className="m-0 text-base font-semibold">
                Add from the library
              </h2>
              <p className={sectionText}>New guardrails run after the ones already attached. Reorder them above.</p>
            </div>
            <Link to="/guardrails" className={textLink}>
              Create a new guardrail
              <ChevronRight />
            </Link>
          </div>
          {attachable.length === 0 ? (
            <p className="m-0 text-sm text-muted">
              {library.some((g) => g.enabled && !g.is_mandatory)
                ? 'Every guardrail in the library is attached.'
                : 'The library has no guardrails to attach yet. Create one, then attach it here.'}
            </p>
          ) : (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-2.5 p-0">
              {attachable.map((g) => (
                <li key={g.id} className="flex flex-col gap-2.5 rounded-[10px] border border-line p-3.5">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">{g.name}</span>
                    {g.description && <span className="text-[13px] leading-5 text-muted">{g.description}</span>}
                  </div>
                  <Badges guardrail={g} />
                  <button
                    type="button"
                    className={`${small} mt-auto self-start font-semibold hover:border-teal hover:bg-teal-soft hover:text-teal-dark`}
                    disabled={busy}
                    aria-label={`Attach ${g.name}`}
                    onClick={() => attachGuardrail(g)}
                  >
                    + Attach
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!unsupported && (
        <section aria-labelledby="guardrail-order-title" className={sectionCard}>
          <div className="flex flex-col gap-1">
            <h2 id="guardrail-order-title" className="m-0 text-base font-semibold">
              Runs in this order
            </h2>
            <p className={sectionText}>What the gateway enforces now. Paused guardrails are left out.</p>
          </div>
          {effective.isPending ? (
            <p className="m-0 text-sm text-muted">Loading effective guardrails…</p>
          ) : effective.isError ? (
            retry('effective guardrails', () => void effective.refetch())
          ) : (
            <GuardrailFlow agentName={agent.name} input={effective.data.input} output={effective.data.output} />
          )}
        </section>
      )}
    </div>
  )
}
