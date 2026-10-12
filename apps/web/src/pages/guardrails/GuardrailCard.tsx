import { useState } from 'react'
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
  const mandatory = guardrail.is_mandatory === true
  const [confirming, setConfirming] = useState(false)
  const nameId = `guardrail-${guardrail.id}-name`

  const error = update.error ?? remove.error

  return (
    <article
      aria-labelledby={nameId}
      data-highlight={highlighted}
      className={`flex min-h-64 flex-col gap-4 rounded-xl border bg-surface p-5 transition-colors ${
        highlighted ? 'border-teal bg-teal-soft' : 'border-line'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={nameId} className="m-0 text-base font-semibold leading-6">{guardrail.name}</h3>
        <span className={`shrink-0 text-xs font-semibold ${guardrail.enabled ? 'text-teal-dark' : 'text-muted'}`}>
          {guardrail.enabled ? 'Active' : 'Inactive'}
        </span>
      </div>
      {mandatory && (
        <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-teal-dark">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Mandatory · runs first on all your agents
        </p>
      )}
      {guardrail.description && <p className="m-0 text-sm text-muted">{guardrail.description}</p>}
      <div className="flex flex-wrap gap-2">
        <span className={`${badgeClass} bg-[#E6E9F5] text-[#2E3A6B]`}>{engineLabel(guardrail.engine)}</span>
        <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{stageLabel(guardrail.stages)}</span>
        <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{ACTION_LABELS[guardrail.action]}</span>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          aria-pressed={guardrail.enabled}
          disabled={update.isPending}
          onClick={() => update.mutate({ id: guardrail.id, changes: { enabled: !guardrail.enabled } })}
          className={smallButton}
        >
          {update.isPending ? 'Updating…' : guardrail.enabled ? 'Enabled' : 'Disabled'}
        </button>
        <button
          type="button"
          aria-pressed={mandatory}
          disabled={update.isPending}
          onClick={() => update.mutate({ id: guardrail.id, changes: { is_mandatory: !mandatory } })}
          className={smallButton}
        >
          {update.isPending ? 'Updating…' : mandatory ? 'Remove mandatory' : 'Make mandatory'}
        </button>
        {!confirming && (
          <button type="button" onClick={() => setConfirming(true)} className={smallButton}>
            Delete
          </button>
        )}
      </div>
      {confirming && (
        <div role="group" aria-label={`Confirm deletion of ${guardrail.name}`} className="rounded-lg bg-[#FBE7E2] p-3">
          <p className="mt-0 mb-3 text-sm font-semibold text-danger">Delete {guardrail.name}?</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              autoFocus
              disabled={remove.isPending}
              onClick={() => remove.mutate(guardrail.id)}
              className={`${smallButton} border-danger text-danger`}
            >
              {remove.isPending ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button type="button" disabled={remove.isPending} onClick={() => setConfirming(false)} className={smallButton}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error.message}
        </p>
      )}
    </article>
  )
}
