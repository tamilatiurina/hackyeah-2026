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

/** PATCH /agents/{id} body (proposed, docs/api-contract-agents.md). */
export interface AgentUpdate {
  name?: string
  description?: string
  base_url?: string
  /** Object replaces, null removes, omitted keeps. */
  auth_header?: { name: string; value: string } | null
}

/** POST /agents/{id}/gateway-key (B-01). The key is returned once; only its hash is stored. */
export interface GatewayKey {
  agent_id: string
  key: string
  /** Relative to the API root (not under /api/v1), e.g. "/a/{id}". */
  gateway_path: string
  agent_card_path: string
}

// --- guardrails and injection signatures (mirror apps/api/app/guardrails/models.py) ---

export type Engine = 'regex' | 'llm_judge' | 'library' | 'moderation'
export type Stage = 'input' | 'output'
export type GuardrailAction = 'block' | 'redact' | 'warn'
export type TemplateId = 'pii' | 'prompt_injection' | 'toxicity' | 'topic' | 'regex' | 'llm_judge'

export type PiiEntity = 'EMAIL' | 'PHONE' | 'CREDIT_CARD' | 'IBAN'

export type GuardrailConfig =
  | { template: 'pii'; entities: PiiEntity[] }
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
  entities?: PiiEntity[]
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
  /** FR-06: applies to every agent and cannot be detached. Admin only. */
  is_mandatory?: boolean
}

export interface Guardrail extends GuardrailCreate {
  id: string
  enabled: boolean
}

export interface GuardrailUpdate {
  name?: string
  description?: string | null
  enabled?: boolean
  is_mandatory?: boolean
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

// --- FR-05 bindings: mirror apps/api/app/bindings/models.py

export type ScopeType = 'agent' | 'role' | 'user'

export interface BindingCreate {
  scope_type: ScopeType
  scope_id: string
  guardrail_id: string
  order_index: number
  enabled: boolean
}

export interface Binding extends BindingCreate {
  id: string
}

export interface BindingUpdate {
  order_index?: number
  enabled?: boolean
}

export interface EffectiveGuardrail {
  guardrail: Guardrail
  source: 'mandatory' | ScopeType
  binding_id: string | null
  order_index: number
}

/** What the gateway enforces for an (agent, role, user) triple. */
export interface EffectivePolicy {
  agent_id: string | null
  role: string | null
  user_id: string | null
  version: string
  input: EffectiveGuardrail[]
  output: EffectiveGuardrail[]
}

// --- MCP servers (FR-16, mirror apps/api/app/mcp/models.py) ---

export type McpAuthType = 'none' | 'api_key' | 'oauth'

/** What the API sends to register a server; secrets go in, never come back. */
export type McpAuth =
  | { type: 'none' }
  | { type: 'api_key'; header: string; api_key: string }
  | { type: 'oauth'; token_url: string; client_id: string; client_secret: string; scopes: string[] }

export interface McpServerCreate {
  name: string
  url: string
  auth: McpAuth
  allowed_tools: string[]
}

export interface McpServer {
  id: string
  name: string
  url: string
  auth: {
    type: McpAuthType
    header?: string | null
    client_id?: string | null
    scopes: string[]
    has_secret: boolean
  }
  allowed_tools: string[]
  /** Agents using the server (filled in once FR-17 attaches servers to agents). */
  agents: number
}

// --- audit log and sessions (A-07, mirror apps/api/app/audit/models.py) ---

export type AuditAction = 'block' | 'redact' | 'warn'
export type AuditKind = 'guardrail' | 'limit'

export interface AuditEvent {
  id: string
  at: string
  agent_id: string
  agent_name: string | null
  context_id: string | null
  rule_id: string
  rule_name: string
  kind: AuditKind
  stage: 'input' | 'output' | null
  action: AuditAction
  config_version: string | null
  details: string
}

export interface AuditEventPage {
  data: AuditEvent[]
  next_cursor: string | null
}

export interface AuditRule {
  rule_id: string
  rule_name: string
  kind: AuditKind
}

export interface SessionLimit {
  name: string
  used: number
  max: number
  unit?: string | null
}

export interface AgentSession {
  agent_id: string
  agent_name: string | null
  context_id: string
  turns: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  started_at: string
  last_at: string
  duration_seconds: number
  status: 'active' | 'stopped'
  stop_reason: string | null
  events: number
  /** Empty until B-05 (limits) exists. */
  limits: SessionLimit[]
}

export interface SessionPage {
  data: AgentSession[]
  next_cursor: string | null
}

export interface AuditFilters {
  agent_id?: string
  rule_id?: string
  action?: AuditAction
  context_id?: string
}

export interface SessionFilters {
  agent_id?: string
  status?: 'active' | 'stopped'
}
