import type { Agent, Group } from '../api/types'

const MINUTE = 60_000

function seedGroups(): Group[] {
  return [
    { id: 'customer-service', name: 'Customer Service' },
    { id: 'legal', name: 'Legal' },
    { id: 'people', name: 'People' },
    { id: 'engineering', name: 'Engineering' },
  ]
}

// From the "Guardrail Hub Control Panel" prototype. Runtime rule counts are the effective
// command + file rules in packages/pi-control-layer/policy.json.
function seedAgents(now: number): Agent[] {
  return [
    { id: 'dev-agent', name: 'dev-agent', mode: 'runtime', groupId: 'engineering', owner: 'team-alpha', ruleCount: 14, online: true, lastSeenAt: new Date(now).toISOString() },
    { id: 'demo-agent', name: 'demo-agent', mode: 'runtime', groupId: 'engineering', owner: 'demo-team', ruleCount: 14, online: true, lastSeenAt: new Date(now).toISOString() },
    { id: 'readonly-agent', name: 'readonly-agent', mode: 'runtime', groupId: 'engineering', owner: 'demo-team', ruleCount: 7, online: false, lastSeenAt: new Date(now - 12 * MINUTE).toISOString() },
    { id: 'support', name: 'Support Assistant', mode: 'proxy', groupId: 'customer-service', owner: 'demo-team', ruleCount: 6, upstreamUrl: 'https://support-agent.acme.internal/api/chat', status: 'deployed', version: 4 },
    { id: 'returns', name: 'Returns Bot', mode: 'proxy', groupId: 'customer-service', owner: 'demo-team', ruleCount: 4, upstreamUrl: 'https://returns.acme.internal/v1/chat', status: 'draft', version: null },
    { id: 'contracts', name: 'Contract Summarizer', mode: 'proxy', groupId: 'legal', owner: 'legal-team', ruleCount: 4, upstreamUrl: 'https://legal-ai.acme.internal/summarize', status: 'deployed', version: 2 },
    { id: 'hr', name: 'HR Policy Q&A', mode: 'proxy', groupId: 'people', owner: 'people-team', ruleCount: 3, upstreamUrl: 'https://hr-bot.acme.internal/ask', status: 'deployed', version: 1 },
  ]
}

export const db: { groups: Group[]; agents: Agent[] } = {
  groups: seedGroups(),
  agents: seedAgents(Date.now()),
}

export function resetDb(): void {
  db.groups = seedGroups()
  db.agents = seedAgents(Date.now())
}

export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  )
}

export function uniqueId(base: string, taken: readonly string[]): string {
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}
