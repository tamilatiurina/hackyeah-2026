import type { ReactNode, Ref } from 'react'
import type { AgentFormErrors } from '../../api/validation'
import { inputClass } from '../../ui/classes'

const labelClass = 'text-[13px] font-semibold text-[#30343B]'

interface FieldProps {
  id: string
  label: string
  error?: string
  hint?: string
  children: ReactNode
}

export function Field({ id, label, error, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-[13px] text-muted">
          {hint}
        </p>
      )}
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
  baseUrl: string
}

interface AgentFieldsProps {
  idPrefix: string
  values: AgentFieldValues
  errors: AgentFormErrors
  onChange: (field: keyof AgentFieldValues, value: string) => void
  nameRef?: Ref<HTMLInputElement>
}

/** Name, agent URL and description — shared by the register and edit forms. */
export function AgentFields({ idPrefix, values, errors, onChange, nameRef }: AgentFieldsProps) {
  const id = (field: string) => `${idPrefix}-${field}`
  const invalid = (field: 'name' | 'description' | 'baseUrl', hint = false) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby':
      [errors[field] ? `${id(field)}-error` : '', hint ? `${id(field)}-hint` : ''].filter(Boolean).join(' ') ||
      undefined,
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
        <Field
          id={id('baseUrl')}
          label="Agent URL"
          error={errors.baseUrl}
          hint="An A2A 1.0 agent. The hub reads its Agent Card from /.well-known/agent-card.json."
        >
          <input
            id={id('baseUrl')}
            type="url"
            value={values.baseUrl}
            placeholder="https://"
            onChange={(e) => onChange('baseUrl', e.target.value)}
            {...invalid('baseUrl', true)}
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
    </>
  )
}
