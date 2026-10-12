import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useRegisterAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import {
  hasErrors,
  validateAgentForm,
  type AgentForm,
  type AgentFormErrors,
  type AgentFormField,
} from '../../api/validation'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { PageHeader, PageShell } from '../../ui/Page'
import { useToast } from '../../ui/toastContext'
import { agentPath } from '../agent/setupProgress'
import { cardSummary } from './agentDisplay'
import { Field } from './AgentFields'

const STEPS = [
  { label: 'Connect' },
  { label: 'Guardrails' },
  { label: 'MCP tools', optional: true },
  { label: 'Test' },
  { label: 'Go live' },
]

/** /agents/new — step 1 of an agent's setup. The hub reads the A2A Agent Card and saves the agent
 * only if it answers; the agent's workspace then continues with its guardrails. */
export function RegisterAgentPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const register = useRegisterAgent()
  const [form, setForm] = useState<AgentForm>({
    name: '',
    description: '',
    baseUrl: '',
    sendAuthHeader: false,
    authHeaderName: 'Authorization',
    authHeaderValue: '',
  })
  const [errors, setErrors] = useState<AgentFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const set = (field: AgentFormField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const invalid = (field: AgentFormField, hint?: string) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': [errors[field] ? `reg-${field}-error` : '', hint ?? ''].filter(Boolean).join(' ') || undefined,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateAgentForm(form, { nameOptional: true })
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) return
    register.mutate(
      {
        // Left blank, the API takes the name and description from the Agent Card.
        ...(form.name.trim() ? { name: form.name.trim() } : {}),
        ...(form.description.trim() ? { description: form.description } : {}),
        base_url: form.baseUrl.trim(),
        auth_header: form.sendAuthHeader ? { name: form.authHeaderName.trim(), value: form.authHeaderValue } : null,
      },
      {
        onSuccess: (agent) => {
          toast(`${agent.name} registered. Agent Card ${cardSummary(agent.agent_card)}. Next: attach guardrails.`)
          navigate(agentPath(agent.id, 'guardrails'))
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) setErrors({ name: error.message })
          // 502: the Agent Card couldn't be fetched or isn't a usable A2A 1.0 card; the API says why.
          else if (error instanceof ApiError && error.status === 502) setFormError(error.message)
          else if (error instanceof ApiError && error.status === 422 && error.field === 'base_url') {
            setErrors({ baseUrl: error.message })
          } else setFormError(error.message) // includes auth_header.* 422s: never shown as a Name error
        },
      },
    )
  }

  const base = form.baseUrl.trim().replace(/\/$/, '') || '<agent URL>'
  return (
    <PageShell>
      <Link to="/agents" className="-mb-5 inline-flex min-h-11 items-center self-start text-sm font-semibold no-underline">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="mr-1.5 h-4 w-4" fill="none">
          <path d="m9.5 3.5-4.5 4.5 4.5 4.5M5 8h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Agents
      </Link>
      <PageHeader
        title="Register an agent"
        description="The hub reads the agent's A2A Agent Card and saves the agent only if it answers. You attach guardrails and test it next."
      />

      <ol aria-label="Setup steps" className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-2 p-0">
        {STEPS.map((step, index) => (
          <li key={step.label} className="contents">
            {index > 0 && <span aria-hidden="true" className="h-px w-8 bg-line-strong" />}
            <span
              aria-current={index === 0 ? 'step' : undefined}
              className={`flex items-center gap-2 text-[13px] ${index === 0 ? 'font-semibold text-teal-dark' : 'font-medium text-muted'}`}
            >
              <span
                className={`flex size-[22px] items-center justify-center rounded-full text-xs ${
                  index === 0
                    ? 'bg-teal font-bold text-white'
                    : `border-[1.5px] font-semibold ${step.optional ? 'border-dashed' : ''} border-line-strong`
                }`}
              >
                {index + 1}
              </span>
              {step.label}
              {step.optional && <span className="text-[11px] font-medium">(optional)</span>}
            </span>
          </li>
        ))}
      </ol>

      <form
        onSubmit={submit}
        noValidate
        aria-labelledby="register-title"
        className="flex max-w-[760px] flex-col gap-5 rounded-xl border border-line bg-surface p-6"
      >
        <h2 id="register-title" className="m-0 text-lg font-semibold">
          Connect the agent
        </h2>

        <Field id="reg-baseUrl" label="Agent URL" error={errors.baseUrl}>
          <input
            id="reg-baseUrl"
            type="url"
            value={form.baseUrl}
            placeholder="https://support-agent.acme.example"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => set('baseUrl', e.target.value)}
            {...invalid('baseUrl', 'reg-baseUrl-card')}
            className={`${inputClass} font-mono text-[13px]`}
          />
          <p id="reg-baseUrl-card" className="m-0 text-xs leading-[18px] text-muted">
            Reads <code className="text-xs break-all">{base}/.well-known/agent-card.json</code>
          </p>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="reg-name" label="Name (optional)" error={errors.name}>
            <input
              id="reg-name"
              value={form.name}
              maxLength={100}
              placeholder="From the Agent Card"
              onChange={(e) => set('name', e.target.value)}
              {...invalid('name')}
              className={inputClass}
            />
          </Field>
          <Field id="reg-description" label="Description (optional)" error={errors.description}>
            <input
              id="reg-description"
              value={form.description}
              placeholder="From the Agent Card"
              onChange={(e) => set('description', e.target.value)}
              {...invalid('description')}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-teal"
              checked={form.sendAuthHeader}
              onChange={(e) => {
                setForm((current) => ({ ...current, sendAuthHeader: e.target.checked }))
                setErrors((current) => ({ ...current, authHeaderName: undefined, authHeaderValue: undefined }))
              }}
            />
            Send an auth header to the agent
          </label>
          {form.sendAuthHeader && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="reg-authHeaderName" label="Header name" error={errors.authHeaderName}>
                  <input
                    id="reg-authHeaderName"
                    value={form.authHeaderName}
                    onChange={(e) => set('authHeaderName', e.target.value)}
                    {...invalid('authHeaderName')}
                    className={`${inputClass} font-mono text-[13px]`}
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
                    className={`${inputClass} font-mono text-[13px]`}
                  />
                </Field>
              </div>
              <p className="m-0 text-xs text-muted">Stored in the hub and never returned to the browser.</p>
            </>
          )}
        </div>

        {formError && (
          <p role="alert" className="m-0 rounded-lg bg-[#FBE7E2] px-3 py-2.5 text-sm text-danger">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <span className="text-[13px] text-muted">Next: attach guardrails</span>
          <div className="flex gap-3">
            <Link to="/agents" className={`${buttonSecondary} no-underline hover:text-ink`}>
              Cancel
            </Link>
            <button type="submit" className={buttonPrimary} disabled={register.isPending}>
              {register.isPending ? 'Reading Agent Card…' : 'Register and continue'}
            </button>
          </div>
        </div>
      </form>
    </PageShell>
  )
}
