import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useUpdateAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import type { Agent, AgentUpdate } from '../../api/types'
import { hasErrors, validateAgentForm, type AgentFormErrors } from '../../api/validation'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { AgentFields, Field, type AgentFieldValues } from '../agents/AgentFields'

type HeaderMode = 'keep' | 'replace' | 'remove' | 'none' | 'add'

const EDIT_UNAVAILABLE = "Editing agents isn't available on this API yet."
const card = 'flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6'

interface EditAgentFormProps {
  agent: Agent
  onClose: () => void
  /** Called after a change was saved (not when nothing changed). */
  onSaved?: (agent: Agent) => void
}

export function EditAgentForm({ agent, onClose, onSaved }: EditAgentFormProps) {
  const hasHeader = agent.auth_header_name !== null
  const [values, setValues] = useState<AgentFieldValues>({
    name: agent.name,
    description: agent.description,
    baseUrl: agent.base_url,
  })
  const [mode, setMode] = useState<HeaderMode>(hasHeader ? 'keep' : 'none')
  const [headerName, setHeaderName] = useState(agent.auth_header_name ?? 'Authorization')
  const [headerValue, setHeaderValue] = useState('')
  const [errors, setErrors] = useState<AgentFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const update = useUpdateAgent(agent.id)
  const nameRef = useRef<HTMLInputElement>(null)
  const sendsHeader = mode === 'replace' || mode === 'add'

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const change = (field: keyof AgentFieldValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateAgentForm({
      name: values.name,
      description: values.description,
      baseUrl: values.baseUrl,
      sendAuthHeader: sendsHeader,
      authHeaderName: headerName,
      authHeaderValue: headerValue,
    })
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) return

    const changes: AgentUpdate = {}
    if (values.name.trim() !== agent.name) changes.name = values.name.trim()
    if (values.description !== agent.description) changes.description = values.description
    if (values.baseUrl.trim() !== agent.base_url) changes.base_url = values.baseUrl.trim()
    if (sendsHeader) changes.auth_header = { name: headerName.trim(), value: headerValue }
    if (mode === 'remove') changes.auth_header = null
    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }

    update.mutate(changes, {
      onSuccess: (saved) => {
        onSaved?.(saved)
        onClose()
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) setErrors({ name: error.message })
        else if (error instanceof ApiError && error.status === 502) setFormError(error.message)
        else if (error instanceof ApiError && error.status === 405) setFormError(EDIT_UNAVAILABLE)
        else if (error instanceof ApiError && error.status === 422 && error.field === 'base_url') {
          setErrors({ baseUrl: error.message })
        } else setFormError(error.message)
      },
    })
  }

  const modes: { id: HeaderMode; label: string }[] = hasHeader
    ? [
        { id: 'keep', label: 'Keep current' },
        { id: 'replace', label: 'Replace' },
        { id: 'remove', label: 'Remove' },
      ]
    : [
        { id: 'none', label: 'None' },
        { id: 'add', label: 'Add' },
      ]

  return (
    <form onSubmit={submit} noValidate aria-labelledby="edit-agent-title" className={card}>
      <div className="flex flex-col gap-1">
        <h2 id="edit-agent-title" className="m-0 text-lg font-semibold">
          Edit connection
        </h2>
        <p className="m-0 text-sm text-muted">
          Saving bumps the config version. Running sessions pick it up on their next call.
        </p>
      </div>

      <AgentFields idPrefix="edit" values={values} errors={errors} onChange={change} nameRef={nameRef} />

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-[13px] font-semibold text-[#30343B]">Auth header</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {modes.map((m) => (
            <label key={m.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name="auth-header-mode"
                checked={mode === m.id}
                onChange={() => {
                  setMode(m.id)
                  setErrors((current) => ({ ...current, authHeaderName: undefined, authHeaderValue: undefined }))
                }}
              />
              {m.label}
            </label>
          ))}
        </div>
        {sendsHeader && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="edit-authHeaderName" label="Header name" error={errors.authHeaderName}>
              <input
                id="edit-authHeaderName"
                value={headerName}
                onChange={(e) => setHeaderName(e.target.value)}
                aria-invalid={Boolean(errors.authHeaderName)}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field id="edit-authHeaderValue" label="Header value" error={errors.authHeaderValue}>
              <input
                id="edit-authHeaderValue"
                type="password"
                autoComplete="off"
                value={headerValue}
                onChange={(e) => setHeaderValue(e.target.value)}
                aria-invalid={Boolean(errors.authHeaderValue)}
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>
        )}
      </fieldset>

      {formError && (
        <p role="alert" className="m-0 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={buttonPrimary} disabled={update.isPending}>
          Save changes
        </button>
      </div>
    </form>
  )
}
