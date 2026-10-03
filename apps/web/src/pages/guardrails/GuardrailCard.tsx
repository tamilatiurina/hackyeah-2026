import { useEffect, useState } from 'react'
import { useDeleteGuardrail, useUpdateGuardrail } from '../../api/guardrails'
import type { Guardrail } from '../../api/types'
import { badgeClass, buttonSecondary } from '../../ui/classes'
import { ACTION_LABELS, engineLabel, stageLabel } from './guardrailDisplay'

interface GuardrailCardProps {
  guardrail: Guardrail
  highlighted: boolean
}

const smallButton = `${buttonSecondary} min-h-11 px-3 text-xs`

export function GuardrailCard({ guardrail, highlighted }: GuardrailCardProps) {
  const update = useUpdateGuardrail()
  const remove = useDeleteGuardrail()
  const [confirming, setConfirming] = useState(false)
  const nameId = `guardrail-${guardrail.id}-name`

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 5000)
    return () => clearTimeout(timer)
  }, [confirming])

  const error = update.error ?? remove.error

  return (
    <article
      aria-labelledby={nameId}
      data-highlight={highlighted}
      className={`flex flex-col gap-3 rounded-xl border bg-surface p-5 transition-colors ${
        highlighted ? 'border-teal bg-teal-soft' : 'border-line'
      } ${guardrail.enabled ? '' : 'opacity-60'}`}
    >
      <h3 id={nameId} className="m-0 text-base font-semibold">
        {guardrail.name}
      </h3>
      {guardrail.description && <p className="m-0 text-sm text-muted">{guardrail.description}</p>}
      <div className="flex flex-wrap gap-2">
        <span className={`${badgeClass} bg-[#E6E9F5] text-[#2E3A6B]`}>{engineLabel(guardrail.engine)}</span>
        <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{stageLabel(guardrail.stages)}</span>
        <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{ACTION_LABELS[guardrail.action]}</span>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={guardrail.enabled}
          disabled={update.isPending}
          onClick={() => update.mutate({ id: guardrail.id, changes: { enabled: !guardrail.enabled } })}
          className={smallButton}
        >
          {guardrail.enabled ? 'Enabled' : 'Disabled'}
        </button>
        {confirming ? (
          <button
            type="button"
            autoFocus
            disabled={remove.isPending}
            onBlur={() => setConfirming(false)}
            onClick={() => remove.mutate(guardrail.id)}
            className={`${smallButton} border-danger text-danger`}
          >
            Confirm delete
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={smallButton}>
            Delete
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error.message}
        </p>
      )}
    </article>
  )
}
