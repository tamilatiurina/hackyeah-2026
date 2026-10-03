import type { Role } from './role'

export interface NavItem {
  path: string
  label: string
  title: string
  issue: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/sessions', label: 'Sessions', title: 'Sessions', issue: 'D-06' },
  { path: '/agents', label: 'Agents', title: 'Agents', issue: 'D-02' },
  { path: '/guardrails', label: 'Guardrails', title: 'Guardrails', issue: 'D-05' },
  { path: '/policies', label: 'Policies', title: 'Policies', issue: 'D-05' },
  { path: '/audit', label: 'Audit log', title: 'Audit log', issue: 'D-06' },
  { path: '/mcp', label: 'MCP servers', title: 'MCP servers', issue: 'S-02' },
  { path: '/evals', label: 'Evaluators', title: 'Evaluators', issue: 'S-01' },
  { path: '/test', label: 'Test chat', title: 'Test chat', issue: 'E-03' },
]

export const TESTER_HOME = '/test'
export const DEFAULT_HOME = '/sessions'

export function homeFor(role: Role): string {
  return role === 'tester' ? TESTER_HOME : DEFAULT_HOME
}

export function navItemsFor(role: Role): readonly NavItem[] {
  return role === 'tester' ? NAV_ITEMS.filter((item) => item.path === TESTER_HOME) : NAV_ITEMS
}
