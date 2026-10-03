import { useEffect, useRef, useState } from 'react'
import { useGuardrailTemplates, useGuardrails } from '../../api/guardrails'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { GuardrailCard } from './GuardrailCard'
import { NewGuardrailForm } from './NewGuardrailForm'
import { SignaturesSection } from './SignaturesSection'

export function GuardrailsPage() {
  const templates = useGuardrailTemplates()
  const guardrails = useGuardrails()
  const [creating, setCreating] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const newButtonRef = useRef<HTMLButtonElement>(null)
  const wasCreating = useRef(false)

  // Give focus back to "New guardrail" when the form closes.
  useEffect(() => {
    if (wasCreating.current && !creating) newButtonRef.current?.focus()
    wasCreating.current = creating
  }, [creating])

  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => setHighlightId(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightId])

  const loaded = templates.isSuccess && guardrails.isSuccess

  let content
  if (templates.isError || guardrails.isError) {
    content = (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-6">
        <span className="text-sm">Couldn't load guardrails.</span>
        <span className="text-[13px] text-muted">
          Is the API running? Start it with <code className="font-mono">make api</code>.
        </span>
        <div>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => {
              void templates.refetch()
              void guardrails.refetch()
            }}
          >
            Retry
          </button>
        </div>
      </div>
    )
  } else if (!loaded) {
    content = (
      <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border border-line bg-surface" />
        ))}
      </div>
    )
  } else if (guardrails.data.length === 0) {
    content = (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        No guardrails yet
      </div>
    )
  } else {
    content = (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {guardrails.data.map((g) => (
          <GuardrailCard key={g.id} guardrail={g} highlighted={g.id === highlightId} />
        ))}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Guardrails</h1>
          <p className="m-0 text-[15px] text-muted">
            Single checks on text going to or from a proxy agent. Each one runs on exactly one engine.
          </p>
        </div>
        {loaded && !creating && (
          <button ref={newButtonRef} type="button" className={buttonPrimary} onClick={() => setCreating(true)}>
            New guardrail
          </button>
        )}
      </header>
      {creating && templates.data && (
        <NewGuardrailForm
          templates={templates.data}
          onClose={() => setCreating(false)}
          onCreated={(guardrail) => setHighlightId(guardrail.id)}
        />
      )}
      {content}
      <SignaturesSection />
    </section>
  )
}
