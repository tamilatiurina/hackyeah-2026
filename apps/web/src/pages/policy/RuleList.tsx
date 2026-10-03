import { useState } from 'react'
import type { CommandRule, FileRule, RedactRule, RegexRule } from '../../api/piPolicy'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import {
  emptyRule,
  isRegexRule,
  isRedactRule,
  ruleDraftErrors,
  rulePrimary,
  ruleTitle,
  describeTimeout,
  type RuleListSpec,
  type RuleValue,
} from './policyDisplay'

const smallButton = `${buttonSecondary} min-h-9 px-2.5 text-xs`
const mono = 'font-mono text-[12.5px]'

interface RuleListProps {
  spec: RuleListSpec
  showTimeout: boolean
  rules: RuleValue[] | undefined
  disabled?: boolean
  onChange: (rules: RuleValue[]) => void
}

// Editor for one rule list (e.g. commands.banned): rows + inline add/edit form.
export function RuleList({ spec, showTimeout, rules, disabled, onChange }: RuleListProps) {
  const [editingIndex, setEditingIndex] = useState<number | 'new' | null>(null)
  const list = rules ?? []

  const upsert = (rule: RuleValue, index: number | 'new') => {
    const next = [...list]
    if (index === 'new') next.push(rule)
    else next[index] = rule
    onChange(next)
    setEditingIndex(null)
  }

  return (
    <div
      role="group"
      aria-label={spec.label}
      className="rounded-lg border border-line bg-canvas/60 p-3"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <h4 className="m-0 text-[13px] font-semibold">{spec.label}</h4>
          <p className="m-0 text-xs text-muted">{spec.description}</p>
        </div>
        <button
          type="button"
          className={smallButton}
          disabled={disabled}
          onClick={() => setEditingIndex('new')}
        >
          Add
        </button>
      </div>

      {list.length === 0 && editingIndex === null && (
        <p className="m-0 py-1 text-xs text-muted italic">None — inherits the defaults.</p>
      )}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.map((rule, index) => (
          <li key={`${rule.id}-${index}`}>
            {editingIndex === index ? (
              <RuleForm
                spec={spec}
                showTimeout={showTimeout}
                initial={rule}
                disabled={disabled}
                onCancel={() => setEditingIndex(null)}
                onSave={(next) => upsert(next, index)}
              />
            ) : (
              <RuleRow
                rule={rule}
                disabled={disabled}
                onEdit={() => setEditingIndex(index)}
                onToggle={(enabled) => {
                  const next = [...list]
                  next[index] = { ...rule, enabled } as RuleValue
                  onChange(next)
                }}
                onRemove={() => onChange(list.filter((_, i) => i !== index))}
              />
            )}
          </li>
        ))}
      </ul>

      {editingIndex === 'new' && (
        <div className="mt-2">
          <RuleForm
            spec={spec}
            showTimeout={showTimeout}
            initial={emptyRule(spec.kind)}
            disabled={disabled}
            onCancel={() => setEditingIndex(null)}
            onSave={(next) => upsert(next, 'new')}
          />
        </div>
      )}
    </div>
  )
}

function RuleRow({
  rule,
  disabled,
  onEdit,
  onToggle,
  onRemove,
}: {
  rule: RuleValue
  disabled?: boolean
  onEdit: () => void
  onToggle: (enabled: boolean) => void
  onRemove: () => void
}) {
  const enabled = !('enabled' in rule) || rule.enabled !== false
  const timeout = describeTimeout(rule)
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 ${
        enabled ? 'border-line bg-surface' : 'border-line bg-canvas opacity-60'
      }`}
    >
      <span className={`${mono} text-muted`}>{ruleTitle(rule)}</span>
      <code className={`${mono} rounded bg-canvas px-1.5 py-0.5`}>{rulePrimary(rule)}</code>
      {'reason' in rule && rule.reason && (
        <span className="min-w-0 basis-full truncate text-xs text-muted sm:basis-auto">{rule.reason}</span>
      )}
      {timeout && <span className="text-xs text-muted">{timeout}</span>}
      <span className="ml-auto flex gap-1.5">
        <button
          type="button"
          aria-pressed={enabled}
          disabled={disabled}
          onClick={() => onToggle(!enabled)}
          className={`${smallButton} ${enabled ? '' : 'opacity-70'}`}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </button>
        <button type="button" className={smallButton} disabled={disabled} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className={smallButton} disabled={disabled} onClick={onRemove}>
          Remove
        </button>
      </span>
    </div>
  )
}

type FieldErrors = Partial<Record<'id' | 'pattern' | 'regex', string>>

interface RuleFormProps {
  spec: RuleListSpec
  showTimeout: boolean
  initial: RuleValue
  disabled?: boolean
  onCancel: () => void
  onSave: (rule: RuleValue) => void
}

export function RuleForm({ spec, showTimeout, initial, disabled, onCancel, onSave }: RuleFormProps) {
  const [draft, setDraft] = useState<RuleValue>(structuredClone(initial))
  const [errors, setErrors] = useState<FieldErrors>({})
  const label = 'text-xs font-semibold text-[#30343B]'
  const errorText = 'text-xs text-danger'

  const set = <K extends keyof (CommandRule & FileRule & RedactRule & RegexRule)>(
    key: K,
    value: (CommandRule & FileRule & RedactRule & RegexRule)[K],
  ) => setDraft((d) => ({ ...d, [key]: value } as RuleValue))

  const save = () => {
    const found = ruleDraftErrors(draft)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    // drop empty optional strings so the payload stays clean
    const cleaned: Record<string, unknown> = { ...draft }
    for (const key of ['reason', 'replacement'] as const) {
      if (cleaned[key] === '') {
        delete cleaned[key]
      }
    }
    onSave(cleaned as unknown as RuleValue)
  }

  return (
    <form
      aria-label={initial.id ? `Edit rule ${initial.id}` : 'New rule'}
      className="flex flex-col gap-3 rounded-md border border-line-strong bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(140px,1fr)_2fr]">
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span className={label}>Rule id</span>
            <input
              className={inputClass}
              value={draft.id}
              aria-invalid={errors.id ? true : undefined}
              onChange={(e) => set('id', e.target.value)}
              placeholder="ban-example"
            />
          </label>
          {errors.id && <span className={errorText}>{errors.id}</span>}
        </div>

        {isRegexRule(draft) ? (
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className={label}>Regex</span>
              <input
                className={inputClass}
                value={draft.regex}
                aria-invalid={errors.regex ? true : undefined}
                onChange={(e) => set('regex', e.target.value)}
                placeholder="(?i)ignore previous instructions"
              />
            </label>
            {errors.regex && <span className={errorText}>{errors.regex}</span>}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className={label}>Pattern (glob, comma-separated allowed)</span>
              <input
                className={inputClass}
                value={rulePrimary(draft)}
                aria-invalid={errors.pattern ? true : undefined}
                onChange={(e) => set('pattern', e.target.value)}
                placeholder="rm -rf *"
              />
            </label>
            {errors.pattern && <span className={errorText}>{errors.pattern}</span>}
          </div>
        )}
      </div>

      {isRedactRule(draft) && (
        <RegexRuleList
          patterns={draft.redactionPatterns}
          disabled={disabled}
          onChange={(patterns) => set('redactionPatterns', patterns)}
        />
      )}

      {'reason' in draft && spec.kind !== 'regex' && (
        <label className="flex flex-col gap-1">
          <span className={label}>Reason (shown to the agent when blocked)</span>
          <input
            className={inputClass}
            value={(draft as CommandRule).reason ?? ''}
            onChange={(e) => set('reason', e.target.value)}
            placeholder="Why this rule exists"
          />
        </label>
      )}

      {spec.kind === 'command' && showTimeout && (
        <label className="flex w-56 flex-col gap-1">
          <span className={label}>Approval timeout (seconds, 0 = wait forever)</span>
          <input
            className={inputClass}
            type="number"
            min={0}
            value={(draft as CommandRule).timeoutSeconds ?? ''}
            onChange={(e) =>
              set('timeoutSeconds', e.target.value === '' ? null : Math.max(0, Number(e.target.value)))
            }
          />
        </label>
      )}

      <div className="flex gap-2">
        <button type="submit" className={buttonPrimary} disabled={disabled}>
          {initial.id ? 'Save rule' : 'Add rule'}
        </button>
        <button type="button" className={buttonSecondary} disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function RegexRuleList({
  patterns,
  disabled,
  onChange,
}: {
  patterns: RegexRule[]
  disabled?: boolean
  onChange: (patterns: RegexRule[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<RegexRule>({ id: '', regex: '' })

  return (
    <fieldset className="m-0 flex flex-col gap-2 rounded-md border border-line p-2">
      <legend className="px-1 text-xs font-semibold text-muted">Redaction regexes</legend>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {patterns.map((r, index) => (
          <li key={`${r.id}-${index}`} className="flex items-center gap-2">
            <span className={`${mono} text-muted`}>{r.id}</span>
            <code className={`${mono} rounded bg-canvas px-1.5 py-0.5`}>{r.regex}</code>
            {r.replacement && <span className="text-xs text-muted">→ {r.replacement}</span>}
            <span className="ml-auto flex gap-1.5">
              <button
                type="button"
                className={smallButton}
                disabled={disabled}
                onClick={() => onChange(patterns.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold">id</span>
            <input
              aria-label="Regex rule id"
              className={`${inputClass} w-40`}
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-semibold">regex</span>
            <input
              aria-label="Regex"
              className={inputClass}
              value={draft.regex}
              onChange={(e) => setDraft({ ...draft, regex: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold">replacement (optional)</span>
            <input
              aria-label="Replacement"
              className={`${inputClass} w-44`}
              value={draft.replacement ?? ''}
              onChange={(e) => setDraft({ ...draft, replacement: e.target.value })}
            />
          </label>
          <button
            type="button"
            className={smallButton}
            disabled={disabled || !draft.id.trim() || !draft.regex.trim()}
            onClick={() => {
              onChange([...patterns, { ...draft, replacement: draft.replacement || undefined }])
              setDraft({ id: '', regex: '' })
              setAdding(false)
            }}
          >
            Add regex
          </button>
          <button type="button" className={smallButton} onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className={smallButton} disabled={disabled} onClick={() => setAdding(true)}>
          Add regex
        </button>
      )}
    </fieldset>
  )
}
