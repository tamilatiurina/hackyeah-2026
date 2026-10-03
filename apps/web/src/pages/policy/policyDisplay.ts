// Labels and factories for the pi policy editor. Mirrors policy.schema.json wording.
import type {
  AgentPolicy,
  CommandRule,
  FileRule,
  PiPolicy,
  RedactRule,
  RegexRule,
} from '../../api/piPolicy'

export type RuleValue = CommandRule | FileRule | RedactRule | RegexRule
export type RuleKind = 'command' | 'file' | 'redact' | 'regex'

export interface RuleListSpec {
  key: string
  kind: RuleKind
  label: string
  description: string
}

export const COMMAND_LISTS: readonly RuleListSpec[] = [
  { key: 'banned', kind: 'command', label: 'Banned commands', description: 'Blocked; the agent is told the reason.' },
  {
    key: 'approval',
    kind: 'command',
    label: 'Approval required',
    description: 'Runs only after human approval.',
  },
  {
    key: 'outputRedact',
    kind: 'command',
    label: 'Output redaction',
    description: 'Matched output is redacted before it reaches the model.',
  },
]

export const FILE_LISTS: readonly RuleListSpec[] = [
  { key: 'blocked', kind: 'file', label: 'Blocked paths', description: 'Cannot be read, edited or listed.' },
  {
    key: 'redact',
    kind: 'redact',
    label: 'Redacted on read',
    description: 'Readable, but matching content is redacted first.',
  },
  { key: 'approval', kind: 'file', label: 'Approval required', description: 'Readable only after human approval.' },
]

export function emptyRule(kind: RuleKind): RuleValue {
  switch (kind) {
    case 'command':
      return { id: '', pattern: '', reason: '', enabled: true }
    case 'file':
      return { id: '', pattern: '', reason: '', enabled: true }
    case 'redact':
      return { id: '', pattern: '', redactionPatterns: [], enabled: true }
    case 'regex':
      return { id: '', regex: '' }
  }
}

export function isCommandRule(rule: RuleValue): rule is CommandRule {
  return 'pattern' in rule && !('redactionPatterns' in rule) && !('regex' in rule)
}

export function isFileRule(rule: RuleValue): rule is FileRule {
  return isCommandRule(rule)
}

export function isRedactRule(rule: RuleValue): rule is RedactRule {
  return 'redactionPatterns' in rule
}

export function isRegexRule(rule: RuleValue): rule is RegexRule {
  return 'regex' in rule
}

export function rulePrimary(rule: RuleValue): string {
  if (isRegexRule(rule)) return rule.regex
  if (isRedactRule(rule)) return rule.pattern
  return rule.pattern
}

export function ruleTitle(rule: RuleValue): string {
  return rule.id || '(no id)'
}

export function sectionLabel(key: keyof AgentPolicy): string {
  const labels: Record<keyof AgentPolicy, string> = {
    identity: 'Identity',
    commands: 'Commands',
    files: 'Files',
    budget: 'Budget',
    time: 'Time limits',
    systemPrompt: 'System prompt',
    injection: 'Injection detection',
    controlPlane: 'Control plane',
  }
  return labels[key]
}

export function newAgentPolicy(): AgentPolicy {
  return {}
}

export function emptyPolicy(): PiPolicy {
  return { version: 1 }
}

// Client-side quick checks; the authoritative validation happens server-side (schema).
export function ruleDraftErrors(rule: RuleValue): Partial<Record<'id' | 'pattern' | 'regex', string>> {
  const errors: Partial<Record<'id' | 'pattern' | 'regex', string>> = {}
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(rule.id)) {
    errors.id = 'Use lowercase letters, digits, dots, underscores or dashes.'
  }
  const primary = rulePrimary(rule)
  if (!primary.trim()) {
    if (isRegexRule(rule)) errors.regex = 'Regex is required.'
    else errors.pattern = 'Pattern is required.'
  }
  return errors
}

export function describeTimeout(rule: RuleValue): string | null {
  if (isRedactRule(rule) || isRegexRule(rule)) return null
  if (rule.timeoutSeconds == null || rule.timeoutSeconds === 0) return 'waits indefinitely'
  return `timeout ${rule.timeoutSeconds}s`
}
