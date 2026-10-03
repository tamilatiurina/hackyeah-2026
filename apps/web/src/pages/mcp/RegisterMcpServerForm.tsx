import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/client'
import { useRegisterMcpServer } from '../../api/mcpServers'
import type { McpAuth, McpAuthType, McpServer } from '../../api/types'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { Field } from '../agents/AgentFields'

// Same rule as the API (apps/api/app/mcp/models.py TOOL_NAME).
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/

interface McpForm {
  name: string
  url: string
  authType: McpAuthType
  header: string
  apiKey: string
  tokenUrl: string
  clientId: string
  clientSecret: string
  scopes: string
  tools: string
}

type FieldName = Exclude<keyof McpForm, 'authType'>
type Errors = Partial<Record<FieldName, string>>

// 422 `loc` ends in the API's field name; map it to the form field.
const API_FIELDS: Record<string, FieldName> = {
  name: 'name',
  url: 'url',
  header: 'header',
  api_key: 'apiKey',
  token_url: 'tokenUrl',
  client_id: 'clientId',
  client_secret: 'clientSecret',
  scopes: 'scopes',
  allowed_tools: 'tools',
}

/** Splits on commas, whitespace and newlines; drops empties. */
function splitList(value: string): string[] {
  return value.split(/[\s,]+/).filter(Boolean)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validate(form: McpForm): Errors {
  const errors: Errors = {}
  if (!form.name.trim()) errors.name = 'Enter a name.'
  else if (form.name.trim().length > 80) errors.name = 'Use at most 80 characters.'
  if (!isHttpUrl(form.url.trim())) errors.url = 'Enter an http(s) URL.'
  if (form.authType === 'api_key') {
    if (!form.header.trim()) errors.header = 'Enter the header name.'
    if (!form.apiKey) errors.apiKey = 'Enter the API key.'
  }
  if (form.authType === 'oauth') {
    if (!isHttpUrl(form.tokenUrl.trim())) errors.tokenUrl = 'Enter an http(s) URL.'
    if (!form.clientId.trim()) errors.clientId = 'Enter the client ID.'
    if (!form.clientSecret) errors.clientSecret = 'Enter the client secret.'
  }
  const tools = splitList(form.tools)
  const bad = tools.filter((t) => !TOOL_NAME.test(t))
  const repeated = tools.filter((t, i) => tools.indexOf(t) !== i)
  if (tools.length === 0) errors.tools = 'List at least one tool.'
  else if (bad.length) errors.tools = `Invalid tool names: ${bad.join(', ')}. Use letters, digits, _ . -`
  else if (repeated.length) errors.tools = `Listed more than once: ${[...new Set(repeated)].join(', ')}`
  return errors
}

function toAuth(form: McpForm): McpAuth {
  if (form.authType === 'api_key') return { type: 'api_key', header: form.header.trim(), api_key: form.apiKey }
  if (form.authType === 'oauth') {
    return {
      type: 'oauth',
      token_url: form.tokenUrl.trim(),
      client_id: form.clientId.trim(),
      client_secret: form.clientSecret,
      scopes: splitList(form.scopes),
    }
  }
  return { type: 'none' }
}

interface Props {
  onClose: () => void
  onRegistered: (server: McpServer) => void
}

export function RegisterMcpServerForm({ onClose, onRegistered }: Props) {
  const [form, setForm] = useState<McpForm>({
    name: '',
    url: '',
    authType: 'none',
    header: 'Authorization',
    apiKey: '',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    scopes: '',
    tools: '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const register = useRegisterMcpServer()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const set = (field: FieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validate(form)
    setErrors(found)
    setFormError(null)
    if (Object.values(found).some(Boolean)) return
    register.mutate(
      { name: form.name.trim(), url: form.url.trim(), auth: toAuth(form), allowed_tools: splitList(form.tools) },
      {
        onSuccess: (server) => {
          onRegistered(server)
          onClose()
        },
        onError: (error) => {
          const field = error instanceof ApiError && error.field ? API_FIELDS[error.field] : undefined
          if (error instanceof ApiError && error.status === 409) setErrors({ name: error.message })
          else if (error instanceof ApiError && error.status === 422 && field) setErrors({ [field]: error.message })
          else setFormError(error.message)
        },
      },
    )
  }

  const input = (field: FieldName, label: string, options: { type?: string; mono?: boolean; placeholder?: string; hint?: string } = {}) => {
    const id = `mcp-${field}`
    const describedBy = [errors[field] ? `${id}-error` : '', options.hint ? `${id}-hint` : ''].filter(Boolean).join(' ')
    return (
      <Field id={id} label={label} error={errors[field]} hint={options.hint}>
        <input
          id={id}
          ref={field === 'name' ? nameRef : undefined}
          type={options.type ?? 'text'}
          autoComplete={options.type === 'password' ? 'off' : undefined}
          value={form[field]}
          placeholder={options.placeholder}
          onChange={(e) => set(field, e.target.value)}
          aria-invalid={Boolean(errors[field])}
          aria-describedby={describedBy || undefined}
          className={`${inputClass} ${options.mono ? 'font-mono' : ''}`}
        />
      </Field>
    )
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="mcp-register-title"
      className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6"
    >
      <h2 id="mcp-register-title" className="m-0 text-lg font-semibold">
        Register an MCP server
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        {input('name', 'Name', { placeholder: 'e.g. Orders' })}
        {input('url', 'URL', { type: 'url', mono: true, placeholder: 'https://' })}
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <label htmlFor="mcp-authType" className="text-[13px] font-semibold text-[#30343B]">
          Auth
        </label>
        <select
          id="mcp-authType"
          value={form.authType}
          onChange={(e) => {
            setForm((current) => ({ ...current, authType: e.target.value as McpAuthType }))
            setFormError(null)
          }}
          className={inputClass}
        >
          <option value="none">None</option>
          <option value="api_key">API key</option>
          <option value="oauth">OAuth (client credentials)</option>
        </select>
      </div>

      {form.authType === 'api_key' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {input('header', 'Header', { mono: true })}
          {input('apiKey', 'API key', { type: 'password', mono: true })}
        </div>
      )}
      {form.authType === 'oauth' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {input('tokenUrl', 'Token URL', { type: 'url', mono: true, placeholder: 'https://' })}
          {input('clientId', 'Client ID', { mono: true })}
          {input('clientSecret', 'Client secret', { type: 'password', mono: true })}
          {input('scopes', 'Scopes', { mono: true, hint: 'Optional. Separate with spaces or commas.' })}
        </div>
      )}

      <Field
        id="mcp-tools"
        label="Allowed tools"
        error={errors.tools}
        hint="The tools agents may call on this server. Separate with commas or new lines."
      >
        <textarea
          id="mcp-tools"
          rows={3}
          value={form.tools}
          placeholder="get_order, search_docs"
          onChange={(e) => set('tools', e.target.value)}
          aria-invalid={Boolean(errors.tools)}
          aria-describedby={[errors.tools ? 'mcp-tools-error' : '', 'mcp-tools-hint'].filter(Boolean).join(' ')}
          className={`${inputClass} py-2 font-mono`}
        />
      </Field>

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
          {register.isPending ? 'Registering…' : 'Register'}
        </button>
      </div>
    </form>
  )
}
