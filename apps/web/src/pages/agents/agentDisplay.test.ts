import { describe, expect, it } from 'vitest'
import type { ProxyAgent, RuntimeAgent } from '../../api/types'
import { endpointLabel, runtimeStartCommand, statusOf } from './agentDisplay'

const now = Date.parse('2026-10-03T12:00:00Z')
const runtime: RuntimeAgent = {
  id: 'r', name: 'r', mode: 'runtime', groupId: 'g', owner: 'o', ruleCount: 0, online: false, lastSeenAt: null,
}
const proxy: ProxyAgent = {
  id: 'p', name: 'p', mode: 'proxy', groupId: 'g', owner: 'o', ruleCount: 0,
  upstreamUrl: 'https://p.test/chat', status: 'draft', version: null,
}
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()

describe('statusOf', () => {
  it('labels proxy agents by deploy status', () => {
    expect(statusOf(proxy)).toEqual({ label: 'Draft', tone: 'neutral' })
    expect(statusOf({ ...proxy, status: 'deployed', version: 4 })).toEqual({ label: 'Deployed · v4', tone: 'ok' })
  })

  it('labels runtime agents by connection', () => {
    expect(statusOf({ ...runtime, online: true })).toEqual({ label: 'Online', tone: 'ok' })
    expect(statusOf(runtime)).toEqual({ label: 'Offline', tone: 'warn' })
  })
})

describe('endpointLabel', () => {
  it('shows the upstream URL for proxy agents', () => {
    expect(endpointLabel(proxy, now)).toBe('https://p.test/chat')
  })

  it('describes the WebSocket connection for runtime agents', () => {
    expect(endpointLabel({ ...runtime, online: true, lastSeenAt: ago(0) }, now)).toBe('WebSocket · connected')
    expect(endpointLabel(runtime, now)).toBe('WebSocket · never connected')
    expect(endpointLabel({ ...runtime, lastSeenAt: ago(0.2) }, now)).toBe('WebSocket · last seen just now')
    expect(endpointLabel({ ...runtime, lastSeenAt: ago(12) }, now)).toBe('WebSocket · last seen 12 min ago')
    expect(endpointLabel({ ...runtime, lastSeenAt: ago(150) }, now)).toBe('WebSocket · last seen 3 h ago')
    expect(endpointLabel({ ...runtime, lastSeenAt: ago(60 * 50) }, now)).toBe('WebSocket · last seen 2 d ago')
  })
})

describe('runtimeStartCommand', () => {
  it('builds the pi command for the agent name', () => {
    expect(runtimeStartCommand('billing-bot')).toBe(
      'AGENT_NAME=billing-bot POLICY_PATH=packages/pi-control-layer/policy.json pi -e packages/pi-control-layer/control-layer.ts',
    )
  })
})
