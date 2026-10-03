import type {
  AgentPolicy,
  BudgetSection,
  ControlPlaneSection,
  InjectionSection,
  SystemPromptSection,
  TimeSection,
} from '../../api/piPolicy'
import { inputClass } from '../../ui/classes'
import { COMMAND_LISTS, FILE_LISTS, sectionLabel, type RuleValue } from './policyDisplay'
import { RuleList } from './RuleList'

const numInput = `${inputClass} w-40`
const labelClass = 'text-xs font-semibold text-[#30343B]'

interface AgentPolicyEditorProps {
  value: AgentPolicy
  disabled?: boolean
  onChange: (next: AgentPolicy) => void
  headerActions?: React.ReactNode
}

// Editor for one agentPolicy: identity + rule lists + scalar limit sections.
export function AgentPolicyEditor({ value, disabled, onChange, headerActions }: AgentPolicyEditorProps) {
  const set = <K extends keyof AgentPolicy>(key: K, next: AgentPolicy[K]) =>
    onChange({ ...value, [key]: next })

  const setRuleList = (section: 'commands' | 'files', listKey: string, rules: RuleValue[]) => {
    const current = value[section] ?? {}
    const nextSection = { ...current, [listKey]: rules }
    // drop empty lists entirely so the JSON stays tidy
    if (rules.length === 0) delete nextSection[listKey as keyof typeof nextSection]
    const hasAny = Object.values(nextSection).some((v) => (v ?? []).length > 0)
    set(section, hasAny ? (nextSection as AgentPolicy[typeof section]) : undefined)
  }

  const numberField = (
    section: 'budget' | 'time',
    key: Exclude<keyof BudgetSection | keyof TimeSection, 'onExceed'>,
    label: string,
    step?: string,
  ) => {
    const v = (value[section] ?? {}) as BudgetSection & TimeSection
    return (
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{label}</span>
        <input
          className={numInput}
          type="number"
          step={step}
          min={0}
          disabled={disabled}
          value={(v[key] as number | undefined) ?? ''}
          onChange={(e) => {
            const raw = e.target.value === '' ? undefined : Number(e.target.value)
            const next = { ...v, [key]: raw } as BudgetSection & TimeSection
            set(section, next as AgentPolicy[typeof section])
          }}
        />
      </label>
    )
  }

  const modeField = (
    section: 'budget' | 'time',
    label: string,
  ) => {
    const v = value[section] ?? {}
    return (
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{label}</span>
        <select
          className={numInput}
          disabled={disabled}
          value={v.onExceed ?? ''}
          onChange={(e) => set(section, { ...v, onExceed: e.target.value as 'block' | 'warn' | undefined })}
        >
          <option value="">default (block)</option>
          <option value="block">block</option>
          <option value="warn">warn</option>
        </select>
      </label>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {headerActions && <div className="flex justify-end">{headerActions}</div>}

      {/* commands */}
      <fieldset className="m-0 rounded-lg border border-line bg-canvas/60 p-3">
        <legend className="px-1 text-[13px] font-semibold">{sectionLabel('commands')}</legend>
        <div className="flex flex-col gap-3">
          {COMMAND_LISTS.map((spec) => (
            <RuleList
              key={spec.key}
              spec={spec}
              showTimeout={spec.key === 'approval'}
              rules={value.commands?.[spec.key as keyof { banned: [] } & string] as RuleValue[] | undefined}
              disabled={disabled}
              onChange={(rules) => setRuleList('commands', spec.key, rules)}
            />
          ))}
        </div>
      </fieldset>

      {/* files */}
      <fieldset className="m-0 rounded-lg border border-line bg-canvas/60 p-3">
        <legend className="px-1 text-[13px] font-semibold">{sectionLabel('files')}</legend>
        <div className="flex flex-col gap-3">
          {FILE_LISTS.map((spec) => (
            <RuleList
              key={spec.key}
              spec={spec}
              showTimeout={spec.key === 'approval'}
              rules={value.files?.[spec.key as keyof { blocked: [] } & string] as RuleValue[] | undefined}
              disabled={disabled}
              onChange={(rules) => setRuleList('files', spec.key, rules)}
            />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* budget */}
        <fieldset className="m-0 rounded-lg border border-line bg-canvas/60 p-3">
          <legend className="px-1 text-[13px] font-semibold">{sectionLabel('budget')}</legend>
          <div className="grid grid-cols-2 gap-3">
            {numberField('budget', 'maxSessionCostUsd', 'Max session cost (USD)', '0.01')}
            {numberField('budget', 'maxTurnCostUsd', 'Max turn cost (USD)', '0.01')}
            {numberField('budget', 'maxSessionTokens', 'Max session tokens')}
            {numberField('budget', 'maxTurnTokens', 'Max turn tokens')}
            {modeField('budget', 'When exceeded')}
          </div>
        </fieldset>

        {/* time */}
        <fieldset className="m-0 rounded-lg border border-line bg-canvas/60 p-3">
          <legend className="px-1 text-[13px] font-semibold">{sectionLabel('time')}</legend>
          <div className="grid grid-cols-2 gap-3">
            {numberField('time', 'maxTurnSeconds', 'Max turn seconds')}
            {numberField('time', 'maxSessionSeconds', 'Max session seconds')}
            {numberField('time', 'alertAfterSeconds', 'Alert after (s)')}
            {modeField('time', 'When exceeded')}
          </div>
        </fieldset>
      </div>

      {/* system prompt */}
      <fieldset className="m-0 rounded-lg border border-line bg-canvas/60 p-3">
        <legend className="px-1 text-[13px] font-semibold">{sectionLabel('systemPrompt')}</legend>
        <div className="flex flex-col gap-3">
          <label className="flex w-48 flex-col gap-1">
            <span className={labelClass}>Mode</span>
            <select
              className={inputClass}
              disabled={disabled}
              value={value.systemPrompt?.mode ?? ''}
              onChange={(e) =>
                set('systemPrompt', {
                  ...(value.systemPrompt ?? {}),
                  mode: e.target.value as SystemPromptSection['mode'],
                })
              }
            >
              <option value="">default (append)</option>
              <option value="append">append</option>
              <option value="replace">replace</option>
              <option value="none">none</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Text</span>
            <textarea
              className={`${inputClass} min-h-20`}
              disabled={disabled}
              value={value.systemPrompt?.text ?? ''}
              onChange={(e) =>
                set('systemPrompt', { ...(value.systemPrompt ?? {}), text: e.target.value })
              }
            />
          </label>
        </div>
      </fieldset>

      {/* injection */}
      <fieldset className="m-0 rounded-lg border border-line bg-canvas/60 p-3">
        <legend className="px-1 text-[13px] font-semibold">{sectionLabel('injection')}</legend>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.injection?.enabled ?? true}
                onChange={(e) =>
                  set('injection', { ...(value.injection ?? {}), enabled: e.target.checked } as InjectionSection)
                }
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.injection?.scanToolResults ?? true}
                onChange={(e) =>
                  set('injection', { ...(value.injection ?? {}), scanToolResults: e.target.checked })
                }
              />
              Scan tool results
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.injection?.scanUserInput ?? false}
                onChange={(e) =>
                  set('injection', { ...(value.injection ?? {}), scanUserInput: e.target.checked })
                }
              />
              Scan user input
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>On detect</span>
              <select
                className={numInput}
                disabled={disabled}
                value={value.injection?.onDetect ?? ''}
                onChange={(e) =>
                  set('injection', { ...(value.injection ?? {}), onDetect: e.target.value as 'block' | 'warn' })
                }
              >
                <option value="">default (warn)</option>
                <option value="block">block</option>
                <option value="warn">warn</option>
              </select>
            </label>
          </div>
          <RuleList
            spec={{
              key: 'patterns',
              kind: 'regex',
              label: 'Injection signature regexes',
              description: 'Extendable signature feed; JavaScript-flavored regex.',
            }}
            showTimeout={false}
            rules={value.injection?.patterns}
            disabled={disabled}
            onChange={(rules) =>
              set('injection', { ...(value.injection ?? {}), patterns: rules as never } as InjectionSection)
            }
          />
        </div>
      </fieldset>

      {/* control plane */}
      <fieldset className="m-0 rounded-lg border border-line bg-canvas/60 p-3">
        <legend className="px-1 text-[13px] font-semibold">{sectionLabel('controlPlane')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>WebSocket URL</span>
            <input
              className={inputClass}
              disabled={disabled}
              placeholder="ws://localhost:4747"
              value={value.controlPlane?.url ?? ''}
              onChange={(e) =>
                set('controlPlane', { ...(value.controlPlane ?? {}), url: e.target.value } as ControlPlaneSection)
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Fallback when unreachable</span>
            <select
              className={inputClass}
              disabled={disabled}
              value={value.controlPlane?.localFallback ?? ''}
              onChange={(e) =>
                set('controlPlane', {
                  ...(value.controlPlane ?? {}),
                  localFallback: e.target.value as ControlPlaneSection['localFallback'],
                })
              }
            >
              <option value="">default (confirm)</option>
              <option value="confirm">confirm</option>
              <option value="block">block</option>
              <option value="allow">allow</option>
            </select>
          </label>
        </div>
      </fieldset>
    </div>
  )
}
