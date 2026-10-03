// Test double for the real guardrail and signature endpoints in apps/api: same paths, shapes and
// error format ({detail}). The browser never uses it — MSW bypasses these paths to the real API.
import { http, HttpResponse } from 'msw'
import type { SendMessageRequest, SendMessageResponse, TraceEntry } from '../api/a2a'
import { apiPath } from '../api/client'
import type {
  Agent,
  AgentCard,
  AgentRegistration,
  Binding,
  BindingCreate,
  BindingUpdate,
  EffectiveGuardrail,
  AgentUpdate,
  DryRunRequest,
  DryRunResult,
  Guardrail,
  GuardrailCreate,
  GuardrailRule,
  GuardrailTemplate,
  GuardrailUpdate,
  InjectionSignature,
  McpServer,
  McpServerCreate,
} from '../api/types'
import { TEST_TOKEN } from './fakeAuth'

export const FAKE_TEMPLATES: GuardrailTemplate[] = [
  { id: 'pii', label: 'PII', engines: ['library', 'regex'], actions: ['block', 'redact', 'warn'] },
  { id: 'prompt_injection', label: 'Prompt injection', engines: ['regex', 'llm_judge'], actions: ['block', 'warn'] },
  { id: 'toxicity', label: 'Toxicity', engines: ['moderation', 'llm_judge'], actions: ['block', 'warn'] },
  { id: 'topic', label: 'Topic allow/deny list', engines: ['llm_judge'], actions: ['block', 'warn'] },
  { id: 'regex', label: 'Regex', engines: ['regex'], actions: ['block', 'redact', 'warn'] },
  { id: 'llm_judge', label: 'LLM judge', engines: ['llm_judge'], actions: ['block', 'warn'] },
]

function seedGuardrails(): Guardrail[] {
  return [
    {
      id: 'gr-pii',
      name: 'PII redaction',
      description: 'Finds phone numbers, emails and card numbers in replies and masks them.',
      engine: 'library',
      stages: ['output'],
      action: 'redact',
      config: { template: 'pii', entities: ['EMAIL', 'PHONE', 'CREDIT_CARD', 'IBAN'] },
      enabled: true,
    },
    {
      id: 'gr-injection',
      name: 'Prompt injection detector',
      description: 'Matches inputs against the company injection signatures.',
      engine: 'regex',
      stages: ['input'],
      action: 'block',
      config: { template: 'prompt_injection', use_company_signatures: true },
      enabled: true,
      is_mandatory: true,
    },
    {
      id: 'gr-toxicity',
      name: 'Toxicity filter',
      description: 'Blocks abusive or harassing language in either direction.',
      engine: 'moderation',
      stages: ['input', 'output'],
      action: 'block',
      config: { template: 'toxicity', threshold: 0.7 },
      enabled: true,
    },
  ]
}

function seedSignatures(): InjectionSignature[] {
  return [
    { id: 'ignore-instructions', regex: '(?i)ignore (all )?(previous|prior|above) (instructions|prompts|rules)' },
    { id: 'reveal-prompt', regex: '(?i)(reveal|print|repeat) (your )?(system prompt|instructions)' },
  ]
}

/** A2A 1.0 Agent Card as the fake agent at `baseUrl` would serve it. */
export function fakeAgentCard(name: string, baseUrl: string): AgentCard {
  return {
    name,
    description: `${name} (from its Agent Card).`,
    version: '1.0.0',
    supportedInterfaces: [{ url: `${baseUrl.replace(/\/$/, '')}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    skills: [{ id: 'orders', name: 'Orders and returns', description: 'Order status.', tags: ['support'] }],
  }
}

function seedAgents(): Agent[] {
  return [
    {
      id: 'agent-support',
      name: 'Support Assistant',
      description: 'Answers order questions.',
      base_url: 'https://support-agent.acme.example',
      upstream_url: 'https://support-agent.acme.example/a2a',
      auth_header_name: 'Authorization',
      agent_card: fakeAgentCard('Support Assistant', 'https://support-agent.acme.example'),
      config_version: 1,
    },
    {
      id: 'agent-contracts',
      name: 'Contract Summarizer',
      description: '',
      // Registered before A2A: no Agent Card.
      base_url: 'https://legal-ai.acme.example/summarize',
      upstream_url: 'https://legal-ai.acme.example/summarize',
      auth_header_name: null,
      agent_card: null,
      config_version: 1,
    },
  ]
}

const signedIn = (request: Request) => request.headers.get('Authorization') === `Bearer ${TEST_TOKEN}`
const notAuthenticated = () => detail(401, 'Not authenticated')

const methodNotAllowed = () => detail(405, 'Method Not Allowed')

function seedMcpServers(): McpServer[] {
  return [
    {
      id: 'mcp-orders',
      name: 'Orders',
      url: 'https://mcp.acme.example/orders',
      auth: { type: 'api_key', header: 'X-Api-Key', scopes: [], has_secret: true },
      allowed_tools: ['get_order', 'list_orders'],
      agents: 0,
    },
  ]
}

function seedBindings(): Binding[] {
  return [
    { id: 'rb-1', scope_type: 'agent', scope_id: 'agent-support', guardrail_id: 'gr-pii', order_index: 0, enabled: true },
  ]
}

// Same rules as apps/api/app/bindings/resolve.py: mandatory first, then enabled agent bindings by
// order_index (ties by library position); disabled or mandatory guardrails are skipped.
function effectiveFor(agentId: string): EffectiveGuardrail[] {
  const mandatory: EffectiveGuardrail[] = fakeApi.guardrails
    .filter((g) => g.enabled && g.is_mandatory)
    .map((g) => ({ guardrail: g, source: 'mandatory', binding_id: null, order_index: 0 }))
  const position = (id: string) => fakeApi.guardrails.findIndex((g) => g.id === id)
  const bound: EffectiveGuardrail[] = fakeApi.bindings
    .filter((b) => b.scope_type === 'agent' && b.scope_id === agentId && b.enabled)
    .map((b) => ({ b, g: fakeApi.guardrails.find((g) => g.id === b.guardrail_id) }))
    .filter((x): x is { b: Binding; g: Guardrail } => Boolean(x.g && x.g.enabled && !x.g.is_mandatory))
    .sort((x, y) => x.b.order_index - y.b.order_index || position(x.g.id) - position(y.g.id))
    .map(({ b, g }) => ({ guardrail: g, source: 'agent', binding_id: b.id, order_index: b.order_index }))
  return [...mandatory, ...bound]
}

const trace = (
  name: string,
  stage: TraceEntry['stage'],
  verdict: TraceEntry['verdict'],
  reason: string,
  engine: TraceEntry['engine'] = 'regex',
  simulated = false,
): TraceEntry => ({
  guardrailId: `gr-${name.toLowerCase().replace(/\W+/g, '-')}`,
  guardrailName: name,
  engine,
  stage,
  verdict,
  reason,
  latencyMs: 3,
  ...(simulated ? { simulated } : {}),
})

const INJECTION_PASS = trace('Prompt injection detector', 'input', 'pass', 'No match')

// Imitates the gateway in front of apps/test-agent (its triggers start the message).
function fakeGateway(request: SendMessageRequest): SendMessageResponse {
  const { message } = request.params
  const text = message.parts.map((p) => ('text' in p ? p.text : '')).join('\n')
  const contextId = message.contextId ?? 'ctx-new'
  const usage = { inputTokens: text.split(/\s+/).length, outputTokens: 12, costUsd: 0.0002 }
  const limits = [{ name: 'Session tokens', used: 24, max: 16000 }]
  const reply = (replyText: string, runs: TraceEntry[]): SendMessageResponse => ({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      message: {
        messageId: `agent-${fakeApi.testChatRequests.length}`,
        contextId,
        role: 'ROLE_AGENT',
        parts: [{ text: replyText }],
        metadata: { guardrailHub: { trace: runs, usage, limits } },
      },
    },
  })
  const blocked = (stage: 'input' | 'output', runs: TraceEntry[], why: string): SendMessageResponse => ({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      task: {
        id: `blk-${fakeApi.testChatRequests.length}`,
        contextId,
        status: {
          state: 'TASK_STATE_REJECTED',
          message: { messageId: `agent-${fakeApi.testChatRequests.length}`, role: 'ROLE_AGENT', parts: [{ text: why }] },
        },
        metadata: { guardrailHub: { blocked: true, stage, trace: runs, usage, limits } },
      },
    },
  })
  switch (text.trim().split(/\s+/)[0]) {
    case '#pii':
      return reply('Reach me at [EMAIL] or [PHONE].', [
        INJECTION_PASS,
        trace('PII redaction', 'output', 'redact', 'Found EMAIL, PHONE', 'library'),
      ])
    case '#secret':
      return reply('Use key [REDACTED].', [INJECTION_PASS, trace('Secret keys', 'output', 'redact', 'Matched /AKIA[0-9A-Z]{16}/')])
    case '#inject':
      return blocked(
        'input',
        [trace('Prompt injection detector', 'input', 'block', 'Matched injection signature: ignore-instructions')],
        'Blocked by guardrail "Prompt injection detector": ignore-instructions signature matched.',
      )
    case '#toxic':
      return blocked(
        'output',
        [INJECTION_PASS, trace('Toxicity filter', 'output', 'block', 'Simulated: Abusive language: idiot', 'moderation', true)],
        'Blocked by guardrail "Toxicity filter".',
      )
    case '#offtopic':
      return reply("Let's talk about elections and crypto.", [
        INJECTION_PASS,
        trace('Topic: orders and returns only', 'output', 'warn', 'Simulated: Mentions a denied topic: crypto', 'llm_judge', true),
      ])
    case '#error':
      return { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Internal error' } }
    default:
      return reply(`You said: ${text}`, [INJECTION_PASS])
  }
}

export const cardUnreachable = (baseUrl: string) =>
  `Could not fetch the agent's A2A Agent Card from ${baseUrl.replace(/\/$/, '')}/.well-known/agent-card.json`

export const fakeApi: {
  guardrails: Guardrail[]
  signatures: InjectionSignature[]
  nextId: number
  agents: Agent[]
  lastAgentRegistration: AgentRegistration | null
  agentId: number
  agentsSupport: { update: boolean; delete: boolean }
  bindings: Binding[]
  bindingsSupported: boolean
  bindingRequests: { method: string; id?: string; body?: unknown }[]
  bindingId: number
  lastAgentUpdate: AgentUpdate | null
  testChatSupported: boolean
  flagsSupported: boolean
  testChatRequests: SendMessageRequest[]
  flags: unknown[]
  gatewayKeys: Record<string, string>
  gatewayKeyCount: number
  mcpServers: McpServer[]
  lastMcpServerCreate: McpServerCreate | null
} = {
  guardrails: seedGuardrails(),
  signatures: seedSignatures(),
  nextId: 1,
  agents: seedAgents(),
  lastAgentRegistration: null,
  agentId: 1,
  agentsSupport: { update: true, delete: true },
  lastAgentUpdate: null,
  testChatSupported: true,
  flagsSupported: true,
  testChatRequests: [],
  flags: [],
  gatewayKeys: {},
  gatewayKeyCount: 0,
  mcpServers: seedMcpServers(),
  lastMcpServerCreate: null,
  bindings: seedBindings(),
  bindingsSupported: true,
  bindingRequests: [],
  bindingId: 1,
}

export function resetFakeApi(): void {
  fakeApi.guardrails = seedGuardrails()
  fakeApi.signatures = seedSignatures()
  fakeApi.nextId = 1
  fakeApi.agents = seedAgents()
  fakeApi.lastAgentRegistration = null
  fakeApi.agentId = 1
  fakeApi.agentsSupport = { update: true, delete: true }
  fakeApi.bindings = seedBindings()
  fakeApi.bindingsSupported = true
  fakeApi.bindingRequests = []
  fakeApi.bindingId = 1
  fakeApi.lastAgentUpdate = null
  fakeApi.testChatSupported = true
  fakeApi.flagsSupported = true
  fakeApi.testChatRequests = []
  fakeApi.flags = []
  fakeApi.gatewayKeys = {}
  fakeApi.gatewayKeyCount = 0
  fakeApi.mcpServers = seedMcpServers()
  fakeApi.lastMcpServerCreate = null
}

const detail = (status: number, message: string) => HttpResponse.json({ detail: message }, { status })

const validation = (message: string, loc: string[] = ['body']) =>
  HttpResponse.json({ detail: [{ type: 'value_error', loc, msg: `Value error, ${message}`, input: null }] }, { status: 422 })

function ruleError(rule: GuardrailRule): string | null {
  const template = FAKE_TEMPLATES.find((t) => t.id === rule.config.template)
  if (!template) return 'unknown template'
  if (!template.engines.includes(rule.engine)) {
    return `engine '${rule.engine}' not allowed for template '${template.id}' (allowed: ${template.engines.join(', ')})`
  }
  if (!template.actions.includes(rule.action)) {
    return `action '${rule.action}' not allowed for template '${template.id}' (allowed: ${template.actions.join(', ')})`
  }
  return null
}

// Enough behaviour for UI tests: real regex, simulated judges flag "idiot".
function fakeDryRun(body: DryRunRequest): DryRunResult {
  const simulated = body.engine === 'llm_judge' || body.engine === 'moderation'
  let reason: string | null = null
  let output: string | null = null
  if (body.config.template === 'regex') {
    const re = new RegExp(body.config.pattern.replace(/^\(\?i\)/, ''), 'g')
    if (re.test(body.text)) {
      reason = `Matched /${body.config.pattern}/`
      output = body.text.replace(re, body.config.replacement)
    }
  } else if (simulated && body.text.toLowerCase().includes('idiot')) {
    reason = 'Abusive language: idiot'
  }
  if (!reason) {
    return { result: 'pass', reason: simulated ? 'Simulated judge found nothing to flag' : 'No match', output: null, simulated }
  }
  return {
    result: body.action,
    reason: simulated ? `Simulated: ${reason}` : reason,
    output: body.action === 'redact' ? output : null,
    simulated,
  }
}

const isAdmin = (request: Request) => request.headers.get('X-Role') === 'admin'

export const fakeApiHandlers = [
  http.get(apiPath('/guardrail-templates'), () => HttpResponse.json(FAKE_TEMPLATES)),
  http.get(apiPath('/guardrails'), () => HttpResponse.json(fakeApi.guardrails)),

  http.post(apiPath('/guardrails/dry-run'), async ({ request }) => {
    const body = (await request.json()) as DryRunRequest
    const error = ruleError(body)
    if (error) return validation(error)
    if (!body.text) return validation('String should have at least 1 character', ['body', 'text'])
    return HttpResponse.json(fakeDryRun(body))
  }),

  http.post(apiPath('/guardrails'), async ({ request }) => {
    const body = (await request.json()) as GuardrailCreate
    const error = ruleError(body)
    if (error) return validation(error)
    const guardrail: Guardrail = { ...body, id: `gr-test-${fakeApi.nextId++}`, enabled: true }
    fakeApi.guardrails.push(guardrail)
    return HttpResponse.json(guardrail, { status: 201 })
  }),

  http.patch(apiPath('/guardrails/:id'), async ({ request, params }) => {
    const index = fakeApi.guardrails.findIndex((g) => g.id === params.id)
    if (index === -1) return detail(404, 'Guardrail not found')
    const changes = (await request.json()) as GuardrailUpdate
    fakeApi.guardrails[index] = { ...fakeApi.guardrails[index], ...changes } as Guardrail
    return HttpResponse.json(fakeApi.guardrails[index])
  }),

  http.delete(apiPath('/guardrails/:id'), ({ params }) => {
    if (!fakeApi.guardrails.some((g) => g.id === params.id)) return detail(404, 'Guardrail not found')
    fakeApi.guardrails = fakeApi.guardrails.filter((g) => g.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(apiPath('/injection-signatures'), () => HttpResponse.json(fakeApi.signatures)),

  http.post(apiPath('/injection-signatures'), async ({ request }) => {
    if (!isAdmin(request)) return detail(403, 'Only admins can change injection signatures')
    const body = (await request.json()) as InjectionSignature
    if (!/^[a-z0-9][a-z0-9-]*$/.test(body.id)) {
      return validation("String should match pattern '^[a-z0-9][a-z0-9-]*$'", ['body', 'id'])
    }
    if (fakeApi.signatures.some((s) => s.id === body.id)) return detail(409, 'A signature with this id already exists')
    fakeApi.signatures.push(body)
    return HttpResponse.json(body, { status: 201 })
  }),

  http.delete(apiPath('/injection-signatures/:id'), ({ request, params }) => {
    if (!isAdmin(request)) return detail(403, 'Only admins can change injection signatures')
    if (!fakeApi.signatures.some((s) => s.id === params.id)) return detail(404, 'Signature not found')
    fakeApi.signatures = fakeApi.signatures.filter((s) => s.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(apiPath('/agents'), ({ request }) => {
    if (!signedIn(request)) return notAuthenticated()
    return HttpResponse.json({ data: fakeApi.agents, total: fakeApi.agents.length })
  }),

  http.post(apiPath('/agents'), async ({ request }) => {
    if (!signedIn(request)) return notAuthenticated()
    const body = (await request.json()) as AgentRegistration
    fakeApi.lastAgentRegistration = body
    if (body.name !== undefined && (!body.name.trim() || body.name.length > 100)) {
      return validation('String should have at most 100 characters', ['body', 'name'])
    }
    if (!/^https?:\/\//.test(body.base_url ?? '')) {
      return validation('Input should be a valid URL', ['body', 'base_url'])
    }
    if (body.auth_header && !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(body.auth_header.name)) {
      return validation('auth header name is not a valid HTTP header name', ['body', 'auth_header', 'name'])
    }
    const card = fakeAgentCard(body.name ?? 'Card Agent', body.base_url)
    const name = body.name ?? card.name
    if (fakeApi.agents.some((a) => a.name === name)) return detail(409, 'An agent with this name already exists')
    if (new URL(body.base_url).hostname.includes('unreachable')) return detail(502, cardUnreachable(body.base_url))
    const agent: Agent = {
      id: `agent-new-${fakeApi.agentId++}`,
      name,
      description: body.description ?? card.description,
      base_url: body.base_url,
      upstream_url: card.supportedInterfaces[0].url,
      auth_header_name: body.auth_header?.name ?? null,
      agent_card: card,
      config_version: 1,
    }
    fakeApi.agents.unshift(agent)
    return HttpResponse.json(agent, { status: 201 })
  }),

  http.get(apiPath('/agents/:id'), ({ request, params }) => {
    if (!signedIn(request)) return notAuthenticated()
    const agent = fakeApi.agents.find((a) => a.id === params.id)
    return agent ? HttpResponse.json(agent) : detail(404, 'Agent not found')
  }),

  http.patch(apiPath('/agents/:id'), async ({ request, params }) => {
    if (!signedIn(request)) return notAuthenticated()
    if (!fakeApi.agentsSupport.update) return methodNotAllowed()
    const index = fakeApi.agents.findIndex((a) => a.id === params.id)
    if (index === -1) return detail(404, 'Agent not found')
    const body = (await request.json()) as AgentUpdate
    fakeApi.lastAgentUpdate = body
    const current = fakeApi.agents[index]
    if (body.name !== undefined && fakeApi.agents.some((a) => a.id !== current.id && a.name === body.name)) {
      return detail(409, 'An agent with this name already exists')
    }
    if (body.base_url !== undefined && new URL(body.base_url).hostname.includes('unreachable')) {
      return detail(502, cardUnreachable(body.base_url))
    }
    const { auth_header, ...fields } = body
    const updated: Agent = {
      ...current,
      ...fields,
      auth_header_name: auth_header === undefined ? current.auth_header_name : (auth_header?.name ?? null),
      config_version: (current.config_version ?? 1) + 1,
    }
    fakeApi.agents[index] = updated
    return HttpResponse.json(updated)
  }),

  http.delete(apiPath('/agents/:id'), ({ request, params }) => {
    if (!signedIn(request)) return notAuthenticated()
    if (!fakeApi.agentsSupport.delete) return methodNotAllowed()
    if (!fakeApi.agents.some((a) => a.id === params.id)) return detail(404, 'Agent not found')
    fakeApi.agents = fakeApi.agents.filter((a) => a.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(apiPath('/mcp-servers'), () => HttpResponse.json(fakeApi.mcpServers)),

  http.post(apiPath('/mcp-servers'), async ({ request }) => {
    const body = (await request.json()) as McpServerCreate
    fakeApi.lastMcpServerCreate = body
    if (fakeApi.mcpServers.some((s) => s.name === body.name)) {
      return detail(409, `MCP server '${body.name}' already exists`)
    }
    const auth = body.auth
    const server: McpServer = {
      id: `mcp-${fakeApi.nextId++}`,
      name: body.name,
      url: body.url,
      auth:
        auth.type === 'api_key'
          ? { type: 'api_key', header: auth.header, scopes: [], has_secret: true }
          : auth.type === 'oauth'
            ? { type: 'oauth', client_id: auth.client_id, scopes: auth.scopes, has_secret: true }
            : { type: 'none', scopes: [], has_secret: false },
      allowed_tools: body.allowed_tools,
      agents: 0,
    }
    fakeApi.mcpServers.push(server)
    return HttpResponse.json(server, { status: 201 })
  }),

  http.delete(apiPath('/mcp-servers/:id'), ({ params }) => {
    if (!fakeApi.mcpServers.some((s) => s.id === params.id)) return detail(404, 'MCP server not found')
    fakeApi.mcpServers = fakeApi.mcpServers.filter((s) => s.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post(apiPath('/agents/:id/gateway-key'), ({ request, params }) => {
    if (!signedIn(request)) return notAuthenticated()
    const id = String(params.id)
    if (!fakeApi.agents.some((a) => a.id === id)) return detail(404, 'Agent not found')
    const key = `ghk_test_${++fakeApi.gatewayKeyCount}`
    fakeApi.gatewayKeys[id] = key
    return HttpResponse.json(
      { agent_id: id, key, gateway_path: `/a/${id}`, agent_card_path: `/a/${id}/.well-known/agent-card.json` },
      { status: 201 },
    )
  }),

  http.post(apiPath('/agents/:id/test-chat'), async ({ request, params }) => {
    if (!signedIn(request)) return notAuthenticated()
    if (!fakeApi.testChatSupported) return detail(404, 'Not Found')
    if (!fakeApi.agents.some((a) => a.id === params.id)) return detail(404, 'Agent not found')
    const body = (await request.json()) as SendMessageRequest
    fakeApi.testChatRequests.push(body)
    return HttpResponse.json(fakeGateway(body))
  }),

  http.post(apiPath('/agents/:id/flags'), async ({ request }) => {
    if (!signedIn(request)) return notAuthenticated()
    if (!fakeApi.flagsSupported) return detail(405, 'Method Not Allowed')
    fakeApi.flags.push(await request.json())
    return HttpResponse.json({ ok: true }, { status: 201 })
  }),

  http.get(apiPath('/bindings'), ({ request }) => {
    if (!fakeApi.bindingsSupported) return detail(404, 'Not Found')
    const url = new URL(request.url)
    const scopeType = url.searchParams.get('scope_type')
    const scopeId = url.searchParams.get('scope_id')
    const list = fakeApi.bindings
      .filter((b) => (!scopeType || b.scope_type === scopeType) && (!scopeId || b.scope_id === scopeId))
      .sort((a, b) => a.order_index - b.order_index)
    return HttpResponse.json(list)
  }),

  http.post(apiPath('/bindings'), async ({ request }) => {
    if (!fakeApi.bindingsSupported) return detail(404, 'Not Found')
    const body = (await request.json()) as BindingCreate
    fakeApi.bindingRequests.push({ method: 'POST', body })
    const guardrail = fakeApi.guardrails.find((g) => g.id === body.guardrail_id)
    if (!guardrail) return detail(404, 'Guardrail not found')
    if (guardrail.is_mandatory) {
      return detail(409, 'Mandatory guardrails already apply everywhere and cannot be attached')
    }
    if (fakeApi.bindings.some((b) => b.scope_type === body.scope_type && b.scope_id === body.scope_id && b.guardrail_id === body.guardrail_id)) {
      return detail(409, 'This guardrail is already attached to that scope')
    }
    const binding: Binding = { ...body, id: `rb-new-${fakeApi.bindingId++}` }
    fakeApi.bindings.push(binding)
    return HttpResponse.json(binding, { status: 201 })
  }),

  http.patch(apiPath('/bindings/:id'), async ({ request, params }) => {
    const body = (await request.json()) as BindingUpdate
    fakeApi.bindingRequests.push({ method: 'PATCH', id: String(params.id), body })
    const index = fakeApi.bindings.findIndex((b) => b.id === params.id)
    if (index === -1) return detail(404, 'Binding not found')
    fakeApi.bindings[index] = { ...fakeApi.bindings[index], ...body }
    return HttpResponse.json(fakeApi.bindings[index])
  }),

  http.delete(apiPath('/bindings/:id'), ({ params }) => {
    fakeApi.bindingRequests.push({ method: 'DELETE', id: String(params.id) })
    if (!fakeApi.bindings.some((b) => b.id === params.id)) return detail(404, 'Binding not found')
    fakeApi.bindings = fakeApi.bindings.filter((b) => b.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(apiPath('/effective-guardrails'), ({ request }) => {
    if (!fakeApi.bindingsSupported) return detail(404, 'Not Found')
    const agentId = new URL(request.url).searchParams.get('agent_id')
    const entries = agentId ? effectiveFor(agentId) : effectiveFor('')
    return HttpResponse.json({
      agent_id: agentId,
      role: null,
      user_id: null,
      version: 'test',
      input: entries.filter((e) => e.guardrail.stages.includes('input')),
      output: entries.filter((e) => e.guardrail.stages.includes('output')),
    })
  }),
]
