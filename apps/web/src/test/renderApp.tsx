import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { AppRoutes } from '../app/AppRoutes'
import { AuthProvider } from '../auth/AuthProvider'
import { createFakeAuth } from './fakeAuth'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

interface RenderOptions {
  signedIn?: boolean
  /** Fake Supabase Realtime (on by default). */
  realtime?: boolean
}

export function renderApp(path: string, { signedIn = true, realtime = true }: RenderOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth({ signedIn, realtime })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider client={auth} initialSession={auth.session}>
          <AppRoutes />
          <LocationProbe />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, auth, queryClient }
}
