import type { Agent } from '../../api/types'

// The guided setup every agent goes through before callers use its guarded URL. Nothing is
// locked: any step can be opened at any time, and Go live only warns about unfinished steps.
export const SETUP_STEPS = ['connection', 'guardrails', 'mcp', 'test', 'deploy'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

/** Workspace sections: the setup steps plus Overview and Activity. */
export const SECTIONS = ['overview', ...SETUP_STEPS, 'activity'] as const
export type Section = (typeof SECTIONS)[number]

export function isSection(value: string | undefined): value is Section {
  return (SECTIONS as readonly string[]).includes(value ?? '')
}

export const STEP_LABEL: Record<SetupStep, string> = {
  connection: 'Connection',
  guardrails: 'Guardrails',
  mcp: 'MCP tools',
  test: 'Test',
  deploy: 'Go live',
}

/** What the button that opens a step says while it is the next one. */
export const STEP_CTA: Record<SetupStep, string> = {
  connection: 'Review connection',
  guardrails: 'Attach guardrails',
  mcp: 'Choose MCP tools',
  test: 'Run a test',
  deploy: 'Create gateway key',
}

export interface SetupCounts {
  /** Enabled guardrails attached to this agent (mandatory ones not counted). */
  attached?: number
  /** MCP servers granted to this agent. */
  mcpServers?: number
}

export interface SetupProgress {
  done: Record<SetupStep, boolean>
  /** The first unfinished step, or null when every step is done. */
  next: SetupStep | null
  doneCount: number
  live: boolean
  /** "Live", or "Setup · n of 5". */
  statusLabel: string
}

/** Where the agent is in its setup. Counts the workspace has loaded complete steps too; the agents
 * list has none and goes by the agent's own flags. */
export function setupProgress(agent: Agent, { attached = 0, mcpServers = 0 }: SetupCounts = {}): SetupProgress {
  const live = Boolean(agent.has_gateway_key)
  const done: Record<SetupStep, boolean> = {
    connection: true,
    guardrails: attached > 0 || Boolean(agent.guardrails_reviewed),
    mcp: mcpServers > 0 || Boolean(agent.mcp_reviewed),
    test: Boolean(agent.tested),
    deploy: live,
  }
  const next = SETUP_STEPS.find((step) => !done[step]) ?? null
  const doneCount = SETUP_STEPS.filter((step) => done[step]).length
  return {
    done,
    next,
    doneCount,
    live,
    statusLabel: live ? 'Live' : `Setup · ${doneCount} of ${SETUP_STEPS.length}`,
  }
}

/** The agent's guarded endpoint (B-01). The gateway sits at the API root (/a/{id}), which the web
 * host forwards to the API like /api, so the panel's own origin is the address callers use. */
export function gatewayUrls(agentId: string): { gateway: string; card: string } {
  const gateway = `${window.location.origin}/a/${encodeURIComponent(agentId)}`
  return { gateway, card: `${gateway}/.well-known/agent-card.json` }
}

export function agentPath(agentId: string, section: Section = 'overview'): string {
  const base = `/agents/${encodeURIComponent(agentId)}`
  return section === 'overview' ? base : `${base}/${section}`
}
