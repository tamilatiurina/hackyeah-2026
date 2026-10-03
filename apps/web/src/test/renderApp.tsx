import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { AppRoutes } from '../app/AppRoutes'
import { ROLE_STORAGE_KEY, type Role } from '../app/role'
import { RoleProvider } from '../app/RoleProvider'
import { AuthProvider } from '../auth/AuthProvider'
import { createFakeAuth } from './fakeAuth'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

export function renderApp(path: string, role?: Role, { signedIn = true }: { signedIn?: boolean } = {}) {
  if (role) localStorage.setItem(ROLE_STORAGE_KEY, role)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth({ signedIn })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider client={auth} initialSession={auth.session}>
          <RoleProvider>
            <AppRoutes />
            <LocationProbe />
          </RoleProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, auth, queryClient }
}
