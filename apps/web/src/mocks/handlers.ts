import { delay, http, HttpResponse } from 'msw'
import type { Agent, ApiErrorBody, Group, RegisterAgentInput } from '../api/types'
import { checkReachable, validateRegistration } from '../api/validation'
import { db, slugify, uniqueId } from './db'

// Visible loading states in the browser; instant in tests.
const latency = () => (import.meta.env.MODE === 'test' ? Promise.resolve() : delay(300))

function fail(status: number, message: string, field?: string) {
  const body: ApiErrorBody = field ? { message, field } : { message }
  return HttpResponse.json(body, { status })
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export const handlers = [
  http.get('/api/agents', async () => {
    await latency()
    return HttpResponse.json(db.agents)
  }),

  http.get('/api/groups', async () => {
    await latency()
    return HttpResponse.json(db.groups)
  }),

  http.post('/api/groups', async ({ request }) => {
    await latency()
    const body = (await request.json()) as { name?: string }
    const name = body.name?.trim() ?? ''
    if (!name) return fail(422, 'Group name is required', 'name')
    if (db.groups.some((g) => sameName(g.name, name))) {
      return fail(409, 'A group with this name already exists', 'name')
    }
    const group: Group = { id: uniqueId(slugify(name), db.groups.map((g) => g.id)), name }
    db.groups.push(group)
    return HttpResponse.json(group, { status: 201 })
  }),

  http.post('/api/agents/test-connection', async ({ request }) => {
    await latency()
    const body = (await request.json()) as { upstreamUrl?: string }
    const url = body.upstreamUrl?.trim() ?? ''
    if (!url) return fail(422, 'Upstream URL is required', 'upstreamUrl')
    return HttpResponse.json(checkReachable(url))
  }),

  http.post('/api/agents', async ({ request }) => {
    await latency()
    const input = (await request.json()) as RegisterAgentInput
    const errors = validateRegistration(input)
    const first = Object.entries(errors).find(([, message]) => Boolean(message))
    if (first) return fail(422, first[1] ?? 'Invalid input', first[0])
    if (!db.groups.some((g) => g.id === input.groupId)) return fail(422, 'Pick a group', 'groupId')

    const name = input.name.trim()
    if (db.agents.some((a) => sameName(a.name, name))) {
      return fail(409, 'An agent with this name already exists', 'name')
    }

    const base = {
      id: uniqueId(slugify(name), db.agents.map((a) => a.id)),
      name,
      groupId: input.groupId,
      owner: input.owner.trim(),
      ruleCount: 0,
    }

    let agent: Agent
    if (input.mode === 'proxy') {
      const upstreamUrl = (input.upstreamUrl ?? '').trim()
      const reach = checkReachable(upstreamUrl)
      if (!reach.reachable) return fail(422, reach.error ?? `Can't reach ${upstreamUrl}`, 'upstreamUrl')
      agent = { ...base, mode: 'proxy', upstreamUrl, status: 'draft', version: null }
    } else {
      agent = { ...base, mode: 'runtime', online: false, lastSeenAt: null }
    }

    db.agents.push(agent)
    return HttpResponse.json(agent, { status: 201 })
  }),
]
