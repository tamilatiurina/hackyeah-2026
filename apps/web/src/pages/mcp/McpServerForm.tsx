import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/client'
import { useRegisterMcpServer, useUpdateMcpServer } from '../../api/mcpServers'
import type { McpAuth, McpAuthType, McpServer, McpServerUpdate } from '../../api/types'
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

function validate(form: McpForm, checkAuth: boolean): Errors {
  const errors: Errors = {}
  if (!form.name.trim()) errors.name = 'Enter a name.'
  else if (form.name.trim().length > 80) errors.name = 'Use at most 80 characters.'
  if (!isHttpUrl(form.url.trim())) errors.url = 'Enter an http(s) URL.'
  if (checkAuth && form.authType === 'api_key') {
    if (!form.header.trim()) errors.header = 'Enter the header name.'
    if (!form.apiKey) errors.apiKey = 'Enter the API key.'
  }
  if (checkAuth && form.authType === 'oauth') {
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
  /** The server to edit; omitted to register a new one. */
  server?: McpServer
  onClose: () => void
  onSaved: (server: McpServer) => void
}

function initialForm(server?: McpServer): McpForm {
  return {
    name: server?.name ?? '',
    url: server?.url ?? '',
    authType: server?.auth.type ?? 'none',
    header: server?.auth.header ?? 'Authorization',
    apiKey: '',
    tokenUrl: '',
    clientId: server?.auth.client_id ?? '',
    clientSecret: '',
    scopes: (server?.auth.scopes ?? []).join(' '),
    tools: (server?.allowed_tools ?? []).join(', '),
  }
}

/** Register a server, or edit one: editing sends only what changed, and keeps the current auth
 * (whose secret can't be read back) unless "Change authentication" is ticked. */
export function McpServerForm({ server, onClose, onSaved }: Props) {
  const editing = server !== undefined
  const prefix = editing ? 'mcp-edit' : 'mcp'
  const [form, setForm] = useState<McpForm>(() => initialForm(server))
  const [changeAuth, setChangeAuth] = useState(!editing)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const register = useRegisterMcpServer()
  const update = useUpdateMcpServer()
  const pending = register.isPending || update.isPending
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const set = (field: FieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const tools = splitList(form.tools)
  const removedTools = editing ? server.allowed_tools.filter((t) => !tools.includes(t)) : []

  const onError = (error: Error) => {
    const field = error instanceof ApiError && error.field ? API_FIELDS[error.field] : undefined
    if (error instanceof ApiError && error.status === 409) setErrors({ name: error.message })
    else if (error instanceof ApiError && error.status === 422 && field) setErrors({ [field]: error.message })
    else setFormError(error.message)
  }
  const done = (saved: McpServer) => {
    onSaved(saved)
    onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validate(form, changeAuth)
    setErrors(found)
    setFormError(null)
    if (Object.values(found).some(Boolean)) return
    if (!editing) {
      register.mutate(
        { name: form.name.trim(), url: form.url.trim(), auth: toAuth(form), allowed_tools: tools },
        { onSuccess: done, onError },
      )
      return
    }
    const changes: McpServerUpdate = {}
    if (form.name.trim() !== server.name) changes.name = form.name.trim()
    if (form.url.trim() !== server.url) changes.url = form.url.trim()
    if (tools.join('\n') !== server.allowed_tools.join('\n')) changes.allowed_tools = tools
    if (changeAuth) changes.auth = toAuth(form)
    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }
    update.mutate({ id: server.id, changes }, { onSuccess: done, onError })
  }

  const input = (field: FieldName, label: string, options: { type?: string; mono?: boolean; placeholder?: string; hint?: string } = {}) => {
    const id = `${prefix}-${field}`
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
      aria-labelledby={`${prefix}-title`}
      className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6"
    >
      <h2 id={`${prefix}-title`} className="m-0 text-lg font-semibold">
        {editing ? `Edit ${server.name}` : 'Register an MCP server'}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        {input('name', 'Name', { placeholder: 'e.g. Orders' })}
        {input('url', 'URL', { type: 'url', mono: true, placeholder: 'https://' })}
      </div>

      {editing && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={changeAuth}
            onChange={(e) => {
              setChangeAuth(e.target.checked)
              setErrors({})
            }}
          />
          Change authentication
          <span className="text-muted">
            (now: {server.auth.type === 'none' ? 'none' : server.auth.type === 'api_key' ? `API key in ${server.auth.header ?? 'Authorization'}` : `OAuth, client ${server.auth.client_id ?? ''}`})
          </span>
        </label>
      )}
      {changeAuth && (
        <>
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <label htmlFor={`${prefix}-authType`} className="text-[13px] font-semibold text-[#30343B]">
            Auth
          </label>
          <select
            id={`${prefix}-authType`}
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
        </>
      )}

      <Field
        id={`${prefix}-tools`}
        label="Allowed tools"
        error={errors.tools}
        hint="The tools agents may call on this server. Separate with commas or new lines."
      >
        <textarea
          id={`${prefix}-tools`}
          rows={3}
          value={form.tools}
          placeholder="get_order, search_docs"
          onChange={(e) => set('tools', e.target.value)}
          aria-invalid={Boolean(errors.tools)}
          aria-describedby={[errors.tools ? `${prefix}-tools-error` : '', `${prefix}-tools-hint`].filter(Boolean).join(' ')}
          className={`${inputClass} py-2 font-mono`}
        />
      </Field>

      {removedTools.length > 0 && server && server.agents > 0 && (
        <p role="status" className="m-0 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">
          Removing {removedTools.join(', ')} also removes {removedTools.length === 1 ? 'it' : 'them'} from the{' '}
          {server.agents === 1 ? 'agent' : `${server.agents} agents`} using this server.
        </p>
      )}

      {formError && (
        <p role="alert" className="m-0 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={buttonPrimary} disabled={pending}>
          {editing ? (pending ? 'Saving…' : 'Save') : pending ? 'Registering…' : 'Register'}
        </button>
      </div>
    </form>
  )
}
