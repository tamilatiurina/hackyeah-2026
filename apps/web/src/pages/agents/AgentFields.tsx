import type { ReactNode, Ref } from 'react'
import type { MessageFormat } from '../../api/types'
import type { AgentFormErrors } from '../../api/validation'
import { inputClass } from '../../ui/classes'

export const UNREACHABLE = "Couldn't reach the upstream agent. Check the URL and that it answers GET requests."

const labelClass = 'text-[13px] font-semibold text-[#30343B]'

export function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
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

export interface AgentFieldValues {
  name: string
  description: string
  upstreamUrl: string
  requestFormat: MessageFormat
  responseFormat: MessageFormat
}

interface AgentFieldsProps {
  idPrefix: string
  values: AgentFieldValues
  errors: AgentFormErrors
  onChange: (field: keyof AgentFieldValues, value: string) => void
  nameRef?: Ref<HTMLInputElement>
}

/** Name, upstream URL, description and formats — shared by the register and edit forms. */
export function AgentFields({ idPrefix, values, errors, onChange, nameRef }: AgentFieldsProps) {
  const id = (field: string) => `${idPrefix}-${field}`
  const invalid = (field: 'name' | 'description' | 'upstreamUrl') => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `${id(field)}-error` : undefined,
  })
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id('name')} label="Name" error={errors.name}>
          <input
            id={id('name')}
            ref={nameRef}
            value={values.name}
            maxLength={100}
            placeholder="e.g. Billing Assistant"
            onChange={(e) => onChange('name', e.target.value)}
            {...invalid('name')}
            className={inputClass}
          />
        </Field>
        <Field id={id('upstreamUrl')} label="Upstream URL" error={errors.upstreamUrl}>
          <input
            id={id('upstreamUrl')}
            type="url"
            value={values.upstreamUrl}
            placeholder="https://"
            onChange={(e) => onChange('upstreamUrl', e.target.value)}
            {...invalid('upstreamUrl')}
            className={`${inputClass} font-mono`}
          />
        </Field>
      </div>

      <Field id={id('description')} label="Description" error={errors.description}>
        <textarea
          id={id('description')}
          rows={2}
          value={values.description}
          onChange={(e) => onChange('description', e.target.value)}
          {...invalid('description')}
          className={`${inputClass} py-2`}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id('request-format')} label="Request format">
          <select
            id={id('request-format')}
            value={values.requestFormat}
            onChange={(e) => onChange('requestFormat', e.target.value)}
            className={inputClass}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </Field>
        <Field id={id('response-format')} label="Response format">
          <select
            id={id('response-format')}
            value={values.responseFormat}
            onChange={(e) => onChange('responseFormat', e.target.value)}
            className={inputClass}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </Field>
      </div>
    </>
  )
}
