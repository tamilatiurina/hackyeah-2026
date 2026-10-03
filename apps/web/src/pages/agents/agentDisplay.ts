import type { Agent } from '../../api/types'

export type Tone = 'ok' | 'neutral' | 'warn'

export const CONTROL_PLANE_URL = 'ws://localhost:4747'

export function statusOf(agent: Agent): { label: string; tone: Tone } {
  if (agent.mode === 'runtime') {
    return agent.online ? { label: 'Online', tone: 'ok' } : { label: 'Offline', tone: 'warn' }
  }
  return agent.status === 'deployed'
    ? { label: `Deployed · v${agent.version ?? 1}`, tone: 'ok' }
    : { label: 'Draft', tone: 'neutral' }
}

export function endpointLabel(agent: Agent, now: number): string {
  if (agent.mode === 'proxy') return agent.upstreamUrl
  if (agent.online) return 'WebSocket · connected'
  if (!agent.lastSeenAt) return 'WebSocket · never connected'
  const minutes = Math.max(0, Math.round((now - Date.parse(agent.lastSeenAt)) / 60_000))
  return `WebSocket · last seen ${formatAgo(minutes)}`
}

function formatAgo(minutes: number): string {
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function runtimeStartCommand(name: string): string {
  return `AGENT_NAME=${name} POLICY_PATH=packages/pi-control-layer/policy.json pi -e packages/pi-control-layer/control-layer.ts`
}
