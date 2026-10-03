import { describe, expect, it } from 'vitest'
import { getJson, postJson } from '../api/client'
import type { Agent, ConnectionResult, Group } from '../api/types'

const register = (body: object) => postJson<Agent>('/agents', body)

describe('mock agents API', () => {
  it('lists the seven seed agents in prototype order', async () => {
    const agents = await getJson<Agent[]>('/agents')
    expect(agents.map((a) => a.id)).toEqual([
      'dev-agent',
      'demo-agent',
      'readonly-agent',
      'support',
      'returns',
      'contracts',
      'hr',
    ])
    expect(agents.find((a) => a.id === 'readonly-agent')).toMatchObject({
      mode: 'runtime',
      online: false,
      ruleCount: 7,
    })
  })

  it('lists the four seed groups', async () => {
    const groups = await getJson<Group[]>('/groups')
    expect(groups.map((g) => g.id)).toEqual(['customer-service', 'legal', 'people', 'engineering'])
  })

  it('registers a runtime agent offline with no rules', async () => {
    const agent = await register({ mode: 'runtime', name: 'billing-bot', groupId: 'legal', owner: 'demo-team' })
    expect(agent).toEqual({
      id: 'billing-bot',
      name: 'billing-bot',
      mode: 'runtime',
      groupId: 'legal',
      owner: 'demo-team',
      ruleCount: 0,
      online: false,
      lastSeenAt: null,
    })
    expect(await getJson<Agent[]>('/agents')).toHaveLength(8)
  })

  it('registers a reachable proxy agent as a draft with trimmed fields', async () => {
    const agent = await register({
      mode: 'proxy',
      name: '  Billing Bot ',
      groupId: 'legal',
      owner: ' demo-team ',
      upstreamUrl: ' https://billing.acme.internal/chat ',
    })
    expect(agent).toMatchObject({
      id: 'billing-bot',
      name: 'Billing Bot',
      owner: 'demo-team',
      mode: 'proxy',
      upstreamUrl: 'https://billing.acme.internal/chat',
      status: 'draft',
      version: null,
      ruleCount: 0,
    })
  })

  it('refuses a proxy agent whose URL is unreachable and saves nothing', async () => {
    await expect(
      register({
        mode: 'proxy',
        name: 'Billing Bot',
        groupId: 'legal',
        owner: 'demo-team',
        upstreamUrl: 'https://billing.unreachable.test',
      }),
    ).rejects.toMatchObject({
      status: 422,
      field: 'upstreamUrl',
      message: "Can't reach https://billing.unreachable.test: host not found",
    })
    expect(await getJson<Agent[]>('/agents')).toHaveLength(7)
  })

  it('refuses a duplicate name regardless of case and surrounding spaces', async () => {
    await expect(
      register({
        mode: 'proxy',
        name: '  support assistant ',
        groupId: 'legal',
        owner: 'demo-team',
        upstreamUrl: 'https://x.acme.internal',
      }),
    ).rejects.toMatchObject({ status: 409, field: 'name', message: 'An agent with this name already exists' })
  })

  it('refuses an invalid runtime name and an unknown group', async () => {
    await expect(
      register({ mode: 'runtime', name: 'Billing Bot', groupId: 'legal', owner: 'demo-team' }),
    ).rejects.toMatchObject({ status: 422, field: 'name' })
    await expect(
      register({ mode: 'runtime', name: 'billing-bot', groupId: 'nope', owner: 'demo-team' }),
    ).rejects.toMatchObject({ status: 422, field: 'groupId', message: 'Pick a group' })
  })

  it('suffixes the id when the slug is already taken', async () => {
    const agent = await register({ mode: 'runtime', name: 'returns', groupId: 'legal', owner: 'demo-team' })
    expect(agent.id).toBe('returns-2')
  })

  it('creates a group and refuses a duplicate name', async () => {
    await expect(postJson<Group>('/groups', { name: ' Finance ' })).resolves.toEqual({
      id: 'finance',
      name: 'Finance',
    })
    await expect(postJson('/groups', { name: 'legal' })).rejects.toMatchObject({
      status: 409,
      message: 'A group with this name already exists',
    })
    await expect(postJson('/groups', { name: '  ' })).rejects.toMatchObject({ status: 422 })
  })

  it('tests connections', async () => {
    const ok = await postJson<ConnectionResult>('/agents/test-connection', {
      upstreamUrl: 'https://billing.acme.internal',
    })
    expect(ok.reachable).toBe(true)
    const bad = await postJson<ConnectionResult>('/agents/test-connection', {
      upstreamUrl: 'https://billing.unreachable.test',
    })
    expect(bad).toEqual({ reachable: false, error: "Can't reach https://billing.unreachable.test: host not found" })
    await expect(postJson('/agents/test-connection', {})).rejects.toMatchObject({ status: 422 })
  })

  it('starts every test from the seed data', async () => {
    expect(await getJson<Agent[]>('/agents')).toHaveLength(7)
  })
})
