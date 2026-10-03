// Hand-written until T-02 (#29) lands; replace with the types generated from the OpenAPI spec.

export interface Group {
  id: string
  name: string
}

export type AgentMode = 'proxy' | 'runtime'

interface AgentBase {
  id: string
  name: string
  groupId: string
  owner: string
  ruleCount: number
}

export interface ProxyAgent extends AgentBase {
  mode: 'proxy'
  upstreamUrl: string
  status: 'draft' | 'deployed'
  version: number | null
}

export interface RuntimeAgent extends AgentBase {
  mode: 'runtime'
  online: boolean
  lastSeenAt: string | null // ISO 8601
}

export type Agent = ProxyAgent | RuntimeAgent

export interface RegisterAgentInput {
  mode: AgentMode
  name: string
  groupId: string
  owner: string
  upstreamUrl?: string // required when mode is 'proxy'
}

export interface ConnectionResult {
  reachable: boolean
  latencyMs?: number
  error?: string
}

export interface ApiErrorBody {
  message: string
  field?: string
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
