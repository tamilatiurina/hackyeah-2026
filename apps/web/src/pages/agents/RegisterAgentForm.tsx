import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useRegisterAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import type { Agent, MessageFormat } from '../../api/types'
import {
  hasErrors,
  validateAgentForm,
  type AgentForm,
  type AgentFormErrors,
  type AgentFormField,
} from '../../api/validation'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'

interface RegisterAgentFormProps {
  onClose: () => void
  onRegistered: (agent: Agent) => void
}

const UNREACHABLE = "Couldn't reach the upstream agent. Check the URL and that it answers GET requests."
const card = 'flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6'
const labelClass = 'text-[13px] font-semibold text-[#30343B]'

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export function RegisterAgentForm({ onClose, onRegistered }: RegisterAgentFormProps) {
  const [form, setForm] = useState<AgentForm>({
    name: '',
    description: '',
    upstreamUrl: '',
    sendAuthHeader: false,
    authHeaderName: 'Authorization',
    authHeaderValue: '',
  })
  const [requestFormat, setRequestFormat] = useState<MessageFormat>('json')
  const [responseFormat, setResponseFormat] = useState<MessageFormat>('json')
  const [errors, setErrors] = useState<AgentFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const register = useRegisterAgent()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const set = (field: AgentFormField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateAgentForm(form)
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) return
    register.mutate(
      {
        name: form.name.trim(),
        description: form.description,
        upstream_url: form.upstreamUrl.trim(),
        auth_header: form.sendAuthHeader
          ? { name: form.authHeaderName.trim(), value: form.authHeaderValue }
          : null,
        request_format: requestFormat,
        response_format: responseFormat,
      },
      {
        onSuccess: (agent) => {
          onRegistered(agent)
          onClose()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) setErrors({ name: error.message })
          else if (error instanceof ApiError && error.status === 502) setFormError(UNREACHABLE)
          else if (error instanceof ApiError && error.status === 422 && error.field === 'upstream_url') {
            setErrors({ upstreamUrl: error.message })
          } else setFormError(error.message) // includes auth_header.* 422s: never shown as a Name error
        },
      },
    )
  }

  const invalid = (field: AgentFormField) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `reg-${field}-error` : undefined,
  })

  return (
    <form onSubmit={submit} noValidate aria-labelledby="register-title" className={card}>
      <h2 id="register-title" className="m-0 text-lg font-semibold">
        Register an agent
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="reg-name" label="Name" error={errors.name}>
          <input
            id="reg-name"
            ref={nameRef}
            value={form.name}
            maxLength={100}
            placeholder="e.g. Billing Assistant"
            onChange={(e) => set('name', e.target.value)}
            {...invalid('name')}
            className={inputClass}
          />
        </Field>
        <Field id="reg-upstreamUrl" label="Upstream URL" error={errors.upstreamUrl}>
          <input
            id="reg-upstreamUrl"
            type="url"
            value={form.upstreamUrl}
            placeholder="https://"
            onChange={(e) => set('upstreamUrl', e.target.value)}
            {...invalid('upstreamUrl')}
            className={`${inputClass} font-mono`}
          />
        </Field>
      </div>

      <Field id="reg-description" label="Description" error={errors.description}>
        <textarea
          id="reg-description"
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          {...invalid('description')}
          className={`${inputClass} py-2`}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="reg-request-format" label="Request format">
          <select
            id="reg-request-format"
            value={requestFormat}
            onChange={(e) => setRequestFormat(e.target.value as MessageFormat)}
            className={inputClass}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </Field>
        <Field id="reg-response-format" label="Response format">
          <select
            id="reg-response-format"
            value={responseFormat}
            onChange={(e) => setResponseFormat(e.target.value as MessageFormat)}
            className={inputClass}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.sendAuthHeader}
            onChange={(e) => {
              setForm((current) => ({ ...current, sendAuthHeader: e.target.checked }))
              setErrors((current) => ({ ...current, authHeaderName: undefined, authHeaderValue: undefined }))
            }}
          />
          Send an auth header
        </label>
        {form.sendAuthHeader && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="reg-authHeaderName" label="Header name" error={errors.authHeaderName}>
              <input
                id="reg-authHeaderName"
                value={form.authHeaderName}
                onChange={(e) => set('authHeaderName', e.target.value)}
                {...invalid('authHeaderName')}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field id="reg-authHeaderValue" label="Header value" error={errors.authHeaderValue}>
              <input
                id="reg-authHeaderValue"
                type="password"
                autoComplete="off"
                value={form.authHeaderValue}
                onChange={(e) => set('authHeaderValue', e.target.value)}
                {...invalid('authHeaderValue')}
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>
        )}
      </div>

      {formError && (
        <p role="alert" className="m-0 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={buttonPrimary} disabled={register.isPending}>
          {register.isPending ? 'Checking upstream…' : 'Register'}
        </button>
      </div>
    </form>
  )
}
