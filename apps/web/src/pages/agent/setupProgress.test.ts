import { describe, expect, it } from 'vitest'
import type { Agent } from '../../api/types'
import { agentPath, isSection, setupProgress } from './setupProgress'

const agent: Agent = {
  id: 'agent-1',
  name: 'Support',
  description: '',
  base_url: 'https://support.example',
  upstream_url: 'https://support.example/a2a',
  auth_header_name: null,
  agent_card: null,
}

describe('setupProgress', () => {
  it('starts with only the connection done and guardrails next', () => {
    const progress = setupProgress(agent)
    expect(progress.next).toBe('guardrails')
    expect(progress.doneCount).toBe(1)
    expect(progress.statusLabel).toBe('Setup · 1 of 5')
    expect(progress.live).toBe(false)
  })

  it('counts an attached guardrail or a reviewed step as done', () => {
    expect(setupProgress(agent, { attached: 1 }).done.guardrails).toBe(true)
    expect(setupProgress({ ...agent, guardrails_reviewed: true }).done.guardrails).toBe(true)
    expect(setupProgress(agent, { mcpServers: 2 }).done.mcp).toBe(true)
    expect(setupProgress({ ...agent, mcp_reviewed: true }).done.mcp).toBe(true)
  })

  it('moves to the first unfinished step, even after a later one is done', () => {
    const progress = setupProgress({ ...agent, guardrails_reviewed: true, tested: true })
    expect(progress.next).toBe('mcp')
    expect(progress.doneCount).toBe(3)
  })

  it('is live once a gateway key exists', () => {
    const progress = setupProgress({ ...agent, has_gateway_key: true })
    expect(progress.live).toBe(true)
    expect(progress.statusLabel).toBe('Live')
  })

  it('has no next step when everything is done', () => {
    const progress = setupProgress({
      ...agent,
      guardrails_reviewed: true,
      mcp_reviewed: true,
      tested: true,
      has_gateway_key: true,
    })
    expect(progress.next).toBeNull()
    expect(progress.doneCount).toBe(5)
  })
})

describe('agentPath', () => {
  it('leaves overview off the path', () => {
    expect(agentPath('a b')).toBe('/agents/a%20b')
    expect(agentPath('a', 'test')).toBe('/agents/a/test')
  })

  it('recognises workspace sections', () => {
    expect(isSection('deploy')).toBe(true)
    expect(isSection('nope')).toBe(false)
    expect(isSection(undefined)).toBe(false)
  })
})
