import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { apiPath } from '../api/client'
import { AppRoutes } from '../app/AppRoutes'
import { RoleProvider } from '../app/RoleProvider'
import { ModeProvider } from '../app/ModeProvider'
import { DEMO_EMAIL, DEMO_PASSWORD, TEST_TOKEN } from '../test/fakeAuth'
import { renderApp } from '../test/renderApp'
import { server } from '../test/server'
import { AuthProvider } from './AuthProvider'

const location = () => screen.getByTestId('location').textContent

async function signIn(user: ReturnType<typeof userEvent.setup>, password = DEMO_PASSWORD) {
  await user.type(screen.getByLabelText('Email'), DEMO_EMAIL)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

function renderUnconfigured() {
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/sessions']}>
        <AuthProvider client={null}>
          <RoleProvider>
            <ModeProvider>
              <AppRoutes />
            </ModeProvider>
          </RoleProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('sign-in', () => {
  it('sends signed-out visitors to /sign-in and back after signing in', async () => {
    const user = userEvent.setup()
    renderApp('/guardrails', undefined, { signedIn: false })
    expect(location()).toBe('/sign-in')
    expect(screen.getByRole('heading', { name: 'Sign in to Guardrail Hub' })).toBeInTheDocument()
    await signIn(user)
    await waitFor(() => expect(location()).toBe('/guardrails'))
  })

  it('shows the Supabase error for a wrong password', async () => {
    const user = userEvent.setup()
    renderApp('/sessions', undefined, { signedIn: false })
    await signIn(user, 'nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
    expect(location()).toBe('/sign-in')
  })

  it('sends the token on the first request after signing in', async () => {
    const seen: (string | null)[] = []
    server.use(
      http.get(apiPath('/agents'), ({ request }) => {
        seen.push(request.headers.get('Authorization'))
        return HttpResponse.json({ data: [], total: 0 })
      }),
    )
    const user = userEvent.setup()
    renderApp('/agents', undefined, { signedIn: false })
    await signIn(user)
    await screen.findByText('No agents yet. Register your first one.')
    expect(seen[0]).toBe(`Bearer ${TEST_TOKEN}`)
  })

  it('shows the signed-in email and signs out', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    expect(screen.getByText(DEMO_EMAIL)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(location()).toBe('/sign-in'))
  })

  it('signs out once and explains when the API rejects the session', async () => {
    let calls = 0
    server.use(
      http.get(apiPath('/agents'), () => {
        calls += 1
        return HttpResponse.json({ detail: 'Invalid Supabase access token' }, { status: 401 })
      }),
    )
    renderApp('/agents')
    expect(await screen.findByText('Your session expired. Sign in again.')).toBeInTheDocument()
    expect(location()).toBe('/sign-in')
    expect(calls).toBe(2) // the request, then one retry after refreshing the session
  })

  it('redirects signed-in users away from /sign-in', () => {
    renderApp('/sign-in')
    expect(location()).toBe('/sessions')
  })

  it('tells production visitors the deployment lacks Supabase settings', () => {
    vi.stubEnv('DEV', false)
    try {
      renderUnconfigured()
      expect(screen.getByText(/built without SUPABASE_URL and SUPABASE_KEY/)).toBeInTheDocument()
      expect(screen.queryByText(/\.env\.local/)).not.toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('explains missing Supabase configuration', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions']}>
          <AuthProvider client={null}>
            <RoleProvider>
              <ModeProvider>
                <AppRoutes />
              </ModeProvider>
            </RoleProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText(/Supabase isn't configured/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('clears cached data on sign-out', async () => {
    const user = userEvent.setup()
    const { auth } = renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(location()).toBe('/sign-in'))
    server.use(http.get(apiPath('/agents'), () => HttpResponse.json({ data: [], total: 0 })))
    await signIn(user)
    await waitFor(() => expect(location()).toBe('/agents'))
    expect(auth.session?.email).toBe(DEMO_EMAIL)
    expect(await screen.findByText('No agents yet. Register your first one.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Support Assistant' })).not.toBeInTheDocument()
  })

  it('refreshes an expired token and retries instead of signing out', async () => {
    const seen: (string | null)[] = []
    server.use(
      http.get(
        apiPath('/agents'),
        ({ request }) => {
          seen.push(request.headers.get('Authorization'))
          return HttpResponse.json({ detail: 'Invalid Supabase access token' }, { status: 401 })
        },
        { once: true },
      ),
    )
    const { auth } = renderApp('/agents')
    expect(await screen.findByRole('link', { name: 'Support Assistant' })).toBeInTheDocument()
    expect(location()).toBe('/agents')
    expect(auth.refreshCalls).toBe(1)
    expect(seen).toEqual([`Bearer ${TEST_TOKEN}`])
  })

  it('clears cached data when Supabase reports a sign-out from elsewhere', async () => {
    const user = userEvent.setup()
    const { auth, queryClient } = renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    await act(() => auth.signOut()) // e.g. signed out in another tab
    await waitFor(() => expect(location()).toBe('/sign-in'))
    expect(queryClient.getQueryData(['agents'])).toBeUndefined()
    server.use(http.get(apiPath('/agents'), () => HttpResponse.json({ data: [], total: 0 })))
    await signIn(user)
    expect(await screen.findByText('No agents yet. Register your first one.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Support Assistant' })).not.toBeInTheDocument()
  })
})
