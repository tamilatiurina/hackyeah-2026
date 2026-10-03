// Agents: mirror apps/api/app/api/routes/agents/models.py

export type MessageFormat = 'json' | 'text'

export interface Agent {
  id: string
  name: string
  description: string
  upstream_url: string
  auth_header_name: string | null
  request_format: MessageFormat
  response_format: MessageFormat
  /** Absent until the backend supports attachments (FR-05). */
  attached_rules?: RuleAttachment[]
  config_version?: number
}

export interface AgentRegistration {
  name: string
  description: string
  upstream_url: string
  auth_header: { name: string; value: string } | null
  request_format: MessageFormat
  response_format: MessageFormat
}

export interface AgentList {
  data: Agent[]
  total: number
}

export interface RuleAttachment {
  rule_id: string
  rule_type: 'guardrail' | 'policy'
  order_index: number
}

export type AgentRuleRef = Pick<RuleAttachment, 'rule_id' | 'rule_type'>

/** PATCH /agents/{id} body (proposed, docs/api-contract-agents.md). */
export interface AgentUpdate {
  name?: string
  description?: string
  upstream_url?: string
  request_format?: MessageFormat
  response_format?: MessageFormat
  /** Object replaces, null removes, omitted keeps. */
  auth_header?: { name: string; value: string } | null
  /** Full list; array order is the execution order. */
  attached_rules?: AgentRuleRef[]
}

// --- guardrails and injection signatures (mirror apps/api/app/guardrails/models.py) ---

export type Engine = 'regex' | 'llm_judge' | 'library' | 'moderation'
export type Stage = 'input' | 'output'
export type GuardrailAction = 'block' | 'redact' | 'warn'
export type TemplateId = 'pii' | 'prompt_injection' | 'toxicity' | 'topic' | 'regex' | 'llm_judge'

export type GuardrailConfig =
  | { template: 'pii'; entities: string[] }
  | { template: 'prompt_injection'; use_company_signatures: boolean }
  | { template: 'toxicity'; threshold: number }
  | { template: 'topic'; mode: 'allow' | 'deny'; topics: string[] }
  | { template: 'regex'; pattern: string; replacement: string }
  | { template: 'llm_judge'; prompt: string }

export interface GuardrailTemplate {
  id: TemplateId
  label: string
  engines: Engine[]
  actions: GuardrailAction[]
}

export interface GuardrailRule {
  engine: Engine
  stages: Stage[]
  action: GuardrailAction
  config: GuardrailConfig
}

export interface GuardrailCreate extends GuardrailRule {
  name: string
  description: string | null
}

export interface Guardrail extends GuardrailCreate {
  id: string
  enabled: boolean
  /** FR-06: applies to every agent; never listed in attached_rules. */
  is_mandatory?: boolean
}

export interface GuardrailUpdate {
  name?: string
  description?: string | null
  enabled?: boolean
}

export interface DryRunRequest extends GuardrailRule {
  text: string
}

export interface DryRunResult {
  result: 'pass' | GuardrailAction
  reason: string
  output: string | null
  simulated: boolean
}

export interface InjectionSignature {
  id: string
  regex: string
}
