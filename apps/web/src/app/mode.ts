import { createContext, useContext } from 'react'

// Top-level work contexts. Higher priority than the role: the role (Admin/Developer/Tester)
// only exists inside the panel mode; agent mode is the pi agent harness integration view.
export type Mode = 'panel' | 'agent'

export const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'agent', label: 'Agent Integrated' },
  { id: 'panel', label: 'Agent Wrapped' },
]

export const MODE_STORAGE_KEY = 'gh.mode'
const DEFAULT_MODE: Mode = 'panel'

function isMode(value: unknown): value is Mode {
  return MODES.some((m) => m.id === value)
}

export function readStoredMode(): Mode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    return isMode(stored) ? stored : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

export function storeMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // storage unavailable (private mode, blocked): the mode lives in memory only
  }
}

export interface ModeContextValue {
  mode: Mode
  setMode: (mode: Mode) => void
}

export const ModeContext = createContext<ModeContextValue | null>(null)

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used inside ModeProvider')
  return ctx
}
