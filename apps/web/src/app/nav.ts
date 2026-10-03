import type { Role } from './role'
import type { Mode } from './mode'

export interface NavItem {
  path: string
  label: string
  title: string
  issue: string
}

// Agent Wrapped (panel) mode: the control room pages.
// Note: /policies lives only in agent mode; there is a redirect for stray deep links.
export const PANEL_NAV_ITEMS: readonly NavItem[] = [
  { path: '/sessions', label: 'Sessions', title: 'Sessions', issue: 'D-06' },
  { path: '/approvals', label: 'Approvals', title: 'Approvals', issue: 'D-06' },
  { path: '/agents', label: 'Agents', title: 'Agents', issue: 'D-02' },
  { path: '/guardrails', label: 'Guardrails', title: 'Guardrails', issue: 'D-05' },
  { path: '/audit', label: 'Audit log', title: 'Audit log', issue: 'D-06' },
  { path: '/mcp', label: 'MCP servers', title: 'MCP servers', issue: 'S-02' },
  { path: '/evals', label: 'Evaluators', title: 'Evaluators', issue: 'S-01' },
  { path: '/test', label: 'Test chat', title: 'Test chat', issue: 'E-03' },
]

// Agent Integrated mode: the pi agent harness integration.
export const AGENT_NAV_ITEMS: readonly NavItem[] = [
  { path: '/playground', label: 'Playground', title: 'Playground', issue: 'D-05' },
  { path: '/policies', label: 'Policies', title: 'Policies', issue: 'D-05' },
]

export const TESTER_HOME = '/test'
export const DEFAULT_HOME = '/sessions'
export const AGENT_HOME = '/playground'

export function homeFor(role: Role, mode: Mode): string {
  if (mode === 'agent') return AGENT_HOME
  return role === 'tester' ? TESTER_HOME : DEFAULT_HOME
}

export function navItemsFor(role: Role, mode: Mode): readonly NavItem[] {
  if (mode === 'agent') return AGENT_NAV_ITEMS
  return role === 'tester' ? PANEL_NAV_ITEMS.filter((item) => item.path === TESTER_HOME) : PANEL_NAV_ITEMS
}
