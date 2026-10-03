import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './context'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, session } = useAuth()
  const location = useLocation()
  if (status === 'loading') return null
  if (!session) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />
  }
  return children
}
