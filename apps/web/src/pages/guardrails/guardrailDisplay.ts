import type { Engine, GuardrailAction, Stage, TemplateId } from '../../api/types'

export const ENGINES: { id: Engine; label: string; hint: string; defaultTemplate: TemplateId }[] = [
  { id: 'regex', label: 'Regex + rules', hint: 'Fast, deterministic patterns', defaultTemplate: 'regex' },
  { id: 'llm_judge', label: 'LLM judge', hint: 'A model scores the text against a prompt', defaultTemplate: 'llm_judge' },
  { id: 'library', label: 'Open-source library', hint: 'e.g. a PII detection library', defaultTemplate: 'pii' },
  { id: 'moderation', label: 'Moderation API', hint: 'Hosted toxicity and safety scoring', defaultTemplate: 'toxicity' },
]

export function engineLabel(engine: Engine): string {
  return ENGINES.find((e) => e.id === engine)?.label ?? engine
}

export function stageLabel(stages: readonly Stage[]): string {
  if (stages.includes('input') && stages.includes('output')) return 'Both'
  return stages.includes('input') ? 'Input' : 'Output'
}

export const ACTION_LABELS: Record<GuardrailAction | 'pass', string> = {
  pass: 'Pass',
  block: 'Block',
  redact: 'Redact',
  warn: 'Warn',
}
