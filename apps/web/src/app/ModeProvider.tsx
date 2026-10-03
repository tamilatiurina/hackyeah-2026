import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ModeContext, readStoredMode, storeMode, type Mode } from './mode'

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(readStoredMode)

  const setMode = useCallback((next: Mode) => {
    setModeState(next)
    storeMode(next)
  }, [])

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode])

  return <ModeContext value={value}>{children}</ModeContext>
}
