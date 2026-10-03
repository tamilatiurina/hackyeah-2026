import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { testConnection, useRegisterAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import type { Agent, AgentMode, ConnectionResult, Group, RegisterAgentInput, RuntimeAgent } from '../../api/types'
import {
  hasErrors,
  isRegistrationField,
  validateRegistration,
  type RegistrationErrors,
  type RegistrationField,
} from '../../api/validation'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { CONTROL_PLANE_URL, runtimeStartCommand } from './agentDisplay'

interface RegisterAgentFormProps {
  groups: readonly Group[]
  defaultGroupId: string
  onClose: () => void
  onRegistered: (agent: Agent) => void
}

const MODES: { id: AgentMode; label: string; hint: string }[] = [
  { id: 'proxy', label: 'Proxy agent', hint: 'Stateless, reached by URL' },
  { id: 'runtime', label: 'Runtime agent', hint: 'pi agent that connects over WebSocket' },
]

const card = 'flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6'

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-[#30343B]">
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

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch {
      // clipboard blocked: the command stays selectable on screen
    }
  }
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg bg-canvas p-3">
      <code className="min-w-0 flex-1 font-mono text-[13px] break-all">{command}</code>
      <button type="button" className={buttonSecondary} onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function RegisterAgentForm({ groups, defaultGroupId, onClose, onRegistered }: RegisterAgentFormProps) {
  const [mode, setMode] = useState<AgentMode>('proxy')
  const [name, setName] = useState('')
  const [upstreamUrl, setUpstreamUrl] = useState('')
  const [groupId, setGroupId] = useState(defaultGroupId)
  const [owner, setOwner] = useState('demo-team')
  const [errors, setErrors] = useState<RegistrationErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [registered, setRegistered] = useState<RuntimeAgent | null>(null)
  const register = useRegisterAgent()
  const nameRef = useRef<HTMLInputElement>(null)
  const doneHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    if (registered) doneHeadingRef.current?.focus()
  }, [registered])

  const isProxy = mode === 'proxy'
  const input: RegisterAgentInput = {
    mode,
    name: name.trim(),
    groupId,
    owner: owner.trim(),
    ...(isProxy ? { upstreamUrl: upstreamUrl.trim() } : {}),
  }

  const edit = (field: RegistrationField, setter: (value: string) => void) => (value: string) => {
    setter(value)
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
    if (field === 'upstreamUrl') setConnection(null)
  }

  const pickMode = (next: AgentMode) => {
    setMode(next)
    setErrors({})
    setFormError(null)
    setConnection(null)
  }

  const runTest = async () => {
    setTesting(true)
    setConnection(null)
    try {
      setConnection(await testConnection(upstreamUrl.trim()))
    } catch (error) {
      setConnection({ reachable: false, error: error instanceof Error ? error.message : 'Connection test failed' })
    } finally {
      setTesting(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateRegistration(input)
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) return
    register.mutate(input, {
      onSuccess: (agent) => {
        onRegistered(agent)
        if (agent.mode === 'runtime') setRegistered(agent)
        else onClose()
      },
      onError: (error) => {
        if (error instanceof ApiError && error.field && isRegistrationField(error.field)) {
          setErrors({ [error.field]: error.message })
        } else {
          setFormError(error.message)
        }
      },
    })
  }

  if (registered) {
    return (
      <section aria-labelledby="register-done-title" className={card}>
        <h2 id="register-done-title" ref={doneHeadingRef} tabIndex={-1} className="m-0 text-lg font-semibold">
          {registered.name} registered
        </h2>
        <p className="m-0 text-sm text-muted">
          Start the pi agent with the Guardrail Hub extension. It reports to the control plane at{' '}
          <code className="font-mono text-[13px]">{CONTROL_PLANE_URL}</code> and appears in Fleet once it connects.
        </p>
        <CommandBlock command={runtimeStartCommand(registered.name)} />
        <div>
          <button type="button" className={buttonPrimary} onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    )
  }

  const describedBy = (field: RegistrationField) => (errors[field] ? `reg-${field}-error` : undefined)

  return (
    <form onSubmit={submit} noValidate aria-labelledby="register-title" className={card}>
      <h2 id="register-title" className="m-0 text-lg font-semibold">
        Register an agent
      </h2>

      <div role="group" aria-label="Agent type" className="grid gap-2 sm:grid-cols-2">
        {MODES.map((m) => {
          const on = mode === m.id
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              onClick={() => pickMode(m.id)}
              className={`flex min-h-11 cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left text-sm ${
                on ? 'border-teal bg-teal-soft' : 'border-line-strong bg-surface hover:bg-canvas'
              }`}
            >
              <span className="font-semibold">{m.label}</span>
              <span className="text-xs text-muted">{m.hint}</span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="reg-name" label="Name" error={errors.name}>
          <input
            id="reg-name"
            ref={nameRef}
            value={name}
            placeholder={isProxy ? 'e.g. Billing Assistant' : 'e.g. billing-assistant'}
            onChange={(e) => edit('name', setName)(e.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('name')}
            className={inputClass}
          />
        </Field>
        {isProxy && (
          <Field id="reg-upstreamUrl" label="Upstream URL" error={errors.upstreamUrl}>
            <input
              id="reg-upstreamUrl"
              type="url"
              value={upstreamUrl}
              placeholder="https://"
              onChange={(e) => edit('upstreamUrl', setUpstreamUrl)(e.target.value)}
              aria-invalid={Boolean(errors.upstreamUrl)}
              aria-describedby={describedBy('upstreamUrl')}
              className={`${inputClass} font-mono`}
            />
          </Field>
        )}
        <Field id="reg-groupId" label="Group" error={errors.groupId}>
          <select
            id="reg-groupId"
            value={groupId}
            onChange={(e) => edit('groupId', setGroupId)(e.target.value)}
            aria-invalid={Boolean(errors.groupId)}
            aria-describedby={describedBy('groupId')}
            className={inputClass}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="reg-owner" label="Owner" error={errors.owner}>
          <input
            id="reg-owner"
            value={owner}
            onChange={(e) => edit('owner', setOwner)(e.target.value)}
            aria-invalid={Boolean(errors.owner)}
            aria-describedby={describedBy('owner')}
            className={inputClass}
          />
        </Field>
      </div>

      {!isProxy && (
        <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3 text-sm text-[#30343B]">
          <span>
            Start the pi agent with the Guardrail Hub extension and this name as <code className="font-mono">AGENT_NAME</code>.
            It reports to <code className="font-mono">{CONTROL_PLANE_URL}</code> and appears in Fleet once it connects.
          </span>
          <code className="font-mono text-[13px] break-all">{runtimeStartCommand(name.trim() || '<name>')}</code>
        </div>
      )}

      {formError && (
        <p role="alert" className="m-0 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {isProxy && (
          <button
            type="button"
            className={buttonSecondary}
            disabled={testing || !upstreamUrl.trim()}
            onClick={() => void runTest()}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        )}
        {isProxy && connection && (
          <span
            role="status"
            className={`text-sm font-semibold ${connection.reachable ? 'text-teal-dark' : 'text-danger'}`}
          >
            {connection.reachable ? `Reachable · ${connection.latencyMs ?? 0} ms` : connection.error}
          </span>
        )}
        <span className="ml-auto flex gap-3">
          <button type="button" className={buttonSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={buttonPrimary} disabled={register.isPending}>
            Register
          </button>
        </span>
      </div>
    </form>
  )
}
