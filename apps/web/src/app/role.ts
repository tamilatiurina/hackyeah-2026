import { createContext, useContext } from 'react'

export type Role = 'admin' | 'dev' | 'tester'

export const ROLES: ReadonlyArray<{ id: Role; label: string; note: string }> = [
  {
    id: 'admin',
    label: 'Admin',
    note: 'Sets mandatory guardrails and caps, and grants exemptions.',
  },
  {
    id: 'dev',
    label: 'Developer',
    note: 'Member of demo-team. Registers A2A agents, builds guardrails and limits, and deploys.',
  },
  {
    id: 'tester',
    label: 'Tester',
    note: 'Tests deployed agents in the chat and flags replies.',
  },
]

export const ROLE_STORAGE_KEY = 'gh.role'
const DEFAULT_ROLE: Role = 'admin'

function isRole(value: unknown): value is Role {
  return ROLES.some((r) => r.id === value)
}

export function readStoredRole(): Role {
  try {
    const stored = localStorage.getItem(ROLE_STORAGE_KEY)
    return isRole(stored) ? stored : DEFAULT_ROLE
  } catch {
    return DEFAULT_ROLE
  }
}

export function storeRole(role: Role): void {
  try {
    localStorage.setItem(ROLE_STORAGE_KEY, role)
  } catch {
    // storage unavailable (private mode, blocked): the role lives in memory only
  }
}

export interface RoleContextValue {
  role: Role
  setRole: (role: Role) => void
}

export const RoleContext = createContext<RoleContextValue | null>(null)

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole must be used inside RoleProvider')
  return ctx
}
