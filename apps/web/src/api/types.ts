// Agents: mirror apps/api/app/api/routes/agents/models.py. Agents speak A2A 1.0
// (docs/agent-contract-a2a.md); the Agent Card keeps the A2A spec's camelCase names.

export interface AgentSkill {
  id: string
  name: string
  description: string
  tags: string[]
}

/** The A2A 1.0 Agent Card fields the UI reads; the stored snapshot may hold more. */
export interface AgentCard {
  name: string
  description: string
  version: string
  supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[]
  skills: AgentSkill[]
}

export interface Agent {
  id: string
  name: string
  description: string
  /** Where the Agent Card lives: <base_url>/.well-known/agent-card.json */
  base_url: string
  /** The A2A JSON-RPC endpoint from the Agent Card. */
  upstream_url: string
  auth_header_name: string | null
  /** Null for agents registered before A2A. */
  agent_card: AgentCard | null
  /** Absent until the backend supports attachments (FR-05). */
  attached_rules?: RuleAttachment[]
  config_version?: number
}

export interface AgentRegistration {
  base_url: string
  /** Omitted: the API uses the Agent Card's name / description. */
  name?: string
  description?: string
  auth_header: { name: string; value: string } | null
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
  base_url?: string
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
