import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { dryRunGuardrail, useCreateGuardrail } from '../../api/guardrails'
import type {
  DryRunResult,
  Engine,
  Guardrail,
  GuardrailAction,
  GuardrailConfig,
  GuardrailTemplate,
  PiiEntity,
  Stage,
  TemplateId,
} from '../../api/types'
import { badgeClass, buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { ACTION_LABELS, ENGINES } from './guardrailDisplay'

interface NewGuardrailFormProps {
  templates: GuardrailTemplate[]
  onClose: () => void
  onCreated: (guardrail: Guardrail) => void
}

type StageChoice = 'input' | 'output' | 'both'
type FieldErrors = Partial<Record<'name' | 'entities' | 'topics' | 'pattern' | 'prompt', string>>

const PII_ENTITIES: ReadonlyArray<{ id: PiiEntity; label: string }> = [
  { id: 'EMAIL', label: 'Email' },
  { id: 'PHONE', label: 'Phone' },
  { id: 'CREDIT_CARD', label: 'Credit card' },
  { id: 'IBAN', label: 'IBAN' },
]

const STAGES: Record<StageChoice, Stage[]> = { input: ['input'], output: ['output'], both: ['input', 'output'] }

const RESULT_TONE: Record<DryRunResult['result'], string> = {
  pass: 'bg-teal-soft text-teal-dark',
  block: 'bg-[#FBE7E2] text-danger',
  redact: 'bg-warn-bg text-warn-fg',
  warn: 'bg-warn-bg text-warn-fg',
}

const card = 'flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6'
const stepLabel = 'text-xs font-semibold tracking-[0.04em] text-muted uppercase'
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

export function NewGuardrailForm({ templates, onClose, onCreated }: NewGuardrailFormProps) {
  const [engine, setEngine] = useState<Engine | null>(null)
  const [templateId, setTemplateId] = useState<TemplateId | null>(null) // null uses the engine's default template.
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [stage, setStage] = useState<StageChoice>('input')
  const [action, setAction] = useState<GuardrailAction>('block')
  const [entities, setEntities] = useState<PiiEntity[]>(PII_ENTITIES.map((e) => e.id))
  const [threshold, setThreshold] = useState('0.7')
  const [topicMode, setTopicMode] = useState<'allow' | 'deny'>('allow')
  const [topics, setTopics] = useState('')
  const [pattern, setPattern] = useState('')
  const [replacement, setReplacement] = useState('[REDACTED]')
  const [prompt, setPrompt] = useState('')
  const [mandatory, setMandatory] = useState(false)
  const [sample, setSample] = useState('')
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [dryRunning, setDryRunning] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const create = useCreateGuardrail()
  const firstEngineRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstEngineRef.current?.focus()
  }, [])

  const engineInfo = ENGINES.find((e) => e.id === engine)
  const effectiveTemplate: TemplateId | null = templateId ?? engineInfo?.defaultTemplate ?? null
  const template = templates.find((t) => t.id === effectiveTemplate)
  const defaultTemplate = templates.find((t) => t.id === engineInfo?.defaultTemplate)
  const allowedActions: GuardrailAction[] = template?.actions ?? ['block', 'redact', 'warn']
  const effectiveAction = allowedActions.includes(action) ? action : allowedActions[0]
  const engineTemplates = engine ? templates.filter((t) => t.engines.includes(engine)) : []

  const pickEngine = (next: Engine) => {
    setEngine(next)
    const current = templates.find((t) => t.id === templateId)
    if (current && !current.engines.includes(next)) setTemplateId(null)
    setDryRun(null)
    setFormError(null)
  }

  const buildConfig = (): GuardrailConfig | null => {
    switch (effectiveTemplate) {
      case 'pii':
        return { template: 'pii', entities }
      case 'prompt_injection':
        return { template: 'prompt_injection', use_company_signatures: true }
      case 'toxicity':
        return { template: 'toxicity', threshold: Number(threshold) }
      case 'topic':
        return {
          template: 'topic',
          mode: topicMode,
          topics: topics
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }
      case 'regex':
        return { template: 'regex', pattern, replacement }
      case 'llm_judge':
        return { template: 'llm_judge', prompt }
      default:
        return null
    }
  }

  const checkTemplateFields = (): FieldErrors => {
    const found: FieldErrors = {}
    if (effectiveTemplate === 'pii' && entities.length === 0) found.entities = 'Pick at least one entity'
    if (effectiveTemplate === 'topic' && !topics.split(',').some((t) => t.trim())) found.topics = 'Add at least one topic'
    if (effectiveTemplate === 'regex' && !pattern) found.pattern = 'Pattern is required'
    if (effectiveTemplate === 'llm_judge' && prompt.trim().length < 10) {
      found.prompt = 'Write a prompt of at least 10 characters'
    }
    return found
  }

  const runDryRun = async () => {
    const config = buildConfig()
    if (!engine || !config) {
      setFormError('Pick an engine first.')
      return
    }
    setDryRunning(true)
    setDryRun(null)
    setFormError(null)
    try {
      setDryRun(await dryRunGuardrail({ engine, stages: STAGES[stage], action: effectiveAction, config, text: sample }))
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Dry run failed')
    } finally {
      setDryRunning(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const config = buildConfig()
    if (!engine || !config) {
      setErrors({})
      setFormError('Pick an engine first.')
      return
    }
    const found = checkTemplateFields()
    if (!name.trim()) found.name = 'Name is required'
    setErrors(found)
    if (Object.values(found).some(Boolean)) return
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        engine,
        stages: STAGES[stage],
        action: effectiveAction,
        config,
        ...(mandatory ? { is_mandatory: true } : {}),
      },
      {
        onSuccess: (guardrail) => {
          onCreated(guardrail)
          onClose()
        },
        onError: (error) => setFormError(error.message),
      },
    )
  }

  const clearError = (field: keyof FieldErrors) => setErrors((current) => ({ ...current, [field]: undefined }))
  const describedBy = (field: keyof FieldErrors) => (errors[field] ? `ng-${field}-error` : undefined)

  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-guardrail-title" className={card}>
      <h2 id="new-guardrail-title" className="m-0 text-lg font-semibold">
        New guardrail
      </h2>

      <div className="flex flex-col gap-2">
        <span id="ng-engine-label" className={stepLabel}>
          1 · Engine (required)
        </span>
        <div role="group" aria-labelledby="ng-engine-label" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {ENGINES.map((e, index) => {
            const on = engine === e.id
            return (
              <button
                key={e.id}
                ref={index === 0 ? firstEngineRef : undefined}
                type="button"
                aria-pressed={on}
                onClick={() => pickEngine(e.id)}
                className={`flex min-h-11 cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left text-sm ${
                  on ? 'border-teal bg-teal-soft' : 'border-line-strong bg-surface hover:bg-canvas'
                }`}
              >
                <span className="font-semibold">{e.label}</span>
                <span className="text-xs text-muted">{e.hint}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span id="ng-template-label" className={stepLabel}>
          2 · Start from a template
        </span>
        <div role="group" aria-label="Template" className="flex flex-wrap gap-2">
          {[{ id: null, label: defaultTemplate ? `Engine default (${defaultTemplate.label})` : 'Engine default' } as const, ...engineTemplates].map((t) => {
            const on = templateId === t.id
            return (
              <button
                key={t.id ?? 'none'}
                type="button"
                aria-pressed={on}
                disabled={!engine}
                onClick={() => {
                  setTemplateId(t.id)
                  setDryRun(null)
                }}
                className={`min-h-11 cursor-pointer rounded-full border px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                  on ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink hover:bg-canvas'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ng-name" label="Name" error={errors.name}>
          <input
            id="ng-name"
            value={name}
            placeholder="e.g. No medical advice"
            onChange={(e) => {
              setName(e.target.value)
              clearError('name')
            }}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('name')}
            className={inputClass}
          />
        </Field>
        <Field id="ng-description" label="Description">
          <input
            id="ng-description"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id="ng-stage" label="Stage">
          <select
            id="ng-stage"
            value={stage}
            onChange={(e) => setStage(e.target.value as StageChoice)}
            className={inputClass}
          >
            <option value="input">Input</option>
            <option value="output">Output</option>
            <option value="both">Both</option>
          </select>
        </Field>
        <Field id="ng-action" label="Action">
          <select
            id="ng-action"
            value={effectiveAction}
            onChange={(e) => setAction(e.target.value as GuardrailAction)}
            className={inputClass}
          >
            {allowedActions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {effectiveTemplate === 'pii' && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={labelClass}>Entities</legend>
          <div className="flex flex-wrap gap-4">
            {PII_ENTITIES.map((entity) => (
              <label key={entity.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={entities.includes(entity.id)}
                  onChange={(e) => {
                    setEntities((current) =>
                      e.target.checked ? [...current, entity.id] : current.filter((x) => x !== entity.id),
                    )
                    clearError('entities')
                  }}
                />
                {entity.label}
              </label>
            ))}
          </div>
          {errors.entities && <p className="m-0 text-[13px] text-danger">{errors.entities}</p>}
        </fieldset>
      )}
      {effectiveTemplate === 'prompt_injection' && (
        <p className="m-0 rounded-lg bg-canvas p-3 text-sm text-[#30343B]">Uses your injection signatures below.</p>
      )}
      {effectiveTemplate === 'toxicity' && (
        <div className="max-w-48">
          <Field id="ng-threshold" label="Threshold">
            <input
              id="ng-threshold"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      )}
      {effectiveTemplate === 'topic' && (
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field id="ng-topic-mode" label="Mode">
            <select
              id="ng-topic-mode"
              value={topicMode}
              onChange={(e) => setTopicMode(e.target.value as 'allow' | 'deny')}
              className={inputClass}
            >
              <option value="allow">Allow only these</option>
              <option value="deny">Deny these</option>
            </select>
          </Field>
          <Field id="ng-topics" label="Topics (comma-separated)" error={errors.topics}>
            <input
              id="ng-topics"
              value={topics}
              placeholder="orders, delivery, returns"
              onChange={(e) => {
                setTopics(e.target.value)
                clearError('topics')
              }}
              aria-invalid={Boolean(errors.topics)}
              aria-describedby={describedBy('topics')}
              className={inputClass}
            />
          </Field>
        </div>
      )}
      {effectiveTemplate === 'regex' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ng-pattern" label="Pattern" error={errors.pattern}>
            <input
              id="ng-pattern"
              value={pattern}
              onChange={(e) => {
                setPattern(e.target.value)
                clearError('pattern')
              }}
              aria-invalid={Boolean(errors.pattern)}
              aria-describedby={describedBy('pattern')}
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field id="ng-replacement" label="Replacement">
            <input
              id="ng-replacement"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>
      )}
      {effectiveTemplate === 'llm_judge' && (
        <Field id="ng-prompt" label="Judge prompt" error={errors.prompt}>
          <textarea
            id="ng-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              clearError('prompt')
            }}
            aria-invalid={Boolean(errors.prompt)}
            aria-describedby={describedBy('prompt')}
            className={`${inputClass} py-2`}
          />
        </Field>
      )}

      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="mt-1" />
        <span>
          <span className="font-semibold">Mandatory</span>
          <span className="block text-xs text-muted">
            Applies to all your existing and future agents and runs first. It can't be detached from one agent.
          </span>
        </span>
      </label>

      <Field id="ng-sample" label="Try it on sample text">
        <textarea
          id="ng-sample"
          rows={3}
          value={sample}
          placeholder="Paste a message to test this guardrail before attaching it"
          onChange={(e) => {
            setSample(e.target.value)
            setDryRun(null)
          }}
          className={`${inputClass} py-2`}
        />
      </Field>

      <div role="status" data-testid="dry-run-result" className="flex flex-col gap-2 empty:hidden">
        {dryRun && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${badgeClass} ${RESULT_TONE[dryRun.result]}`}>{ACTION_LABELS[dryRun.result]}</span>
              {dryRun.simulated && <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>Simulated</span>}
              <span className="text-sm text-muted">{dryRun.reason}</span>
            </div>
            {dryRun.output !== null && (
              <code className="rounded-lg bg-canvas p-3 font-mono text-[13px] break-all">{dryRun.output}</code>
            )}
          </>
        )}
      </div>

      {formError && (
        <p role="alert" className="m-0 text-sm font-semibold text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center">
        <button
          type="button"
          className={buttonSecondary}
          disabled={dryRunning || !sample.trim()}
          onClick={() => void runDryRun()}
        >
          {dryRunning ? 'Running…' : 'Dry run'}
        </button>
        <span className="flex gap-3 sm:ml-auto">
          <button type="button" className={`${buttonSecondary} flex-1 sm:flex-none`} disabled={create.isPending} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${buttonPrimary} flex-1 sm:flex-none`} disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save guardrail'}
          </button>
        </span>
      </div>
    </form>
  )
}
