// Test double for the real guardrail and signature endpoints in apps/api: same paths, shapes and
// error format ({detail}). The browser never uses it — MSW bypasses these paths to the real API.
import { http, HttpResponse } from 'msw'
import { apiPath } from '../api/client'
import type {
  DryRunRequest,
  DryRunResult,
  Guardrail,
  GuardrailCreate,
  GuardrailRule,
  GuardrailTemplate,
  GuardrailUpdate,
  InjectionSignature,
} from '../api/types'

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

export const fakeApi: { guardrails: Guardrail[]; signatures: InjectionSignature[]; nextId: number } = {
  guardrails: seedGuardrails(),
  signatures: seedSignatures(),
  nextId: 1,
}

export function resetFakeApi(): void {
  fakeApi.guardrails = seedGuardrails()
  fakeApi.signatures = seedSignatures()
  fakeApi.nextId = 1
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
]
