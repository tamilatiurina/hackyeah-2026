import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { apiPath } from '../api/client'
import { AppRoutes } from '../app/AppRoutes'
import { CONFIRM_EMAIL, DEMO_EMAIL, DEMO_PASSWORD, TAKEN_EMAIL, TEST_TOKEN } from '../test/fakeAuth'
import { fakeApi } from '../test/fakeApi'
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
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('sign-in', () => {
  it('sends signed-out visitors to /sign-in and back after signing in', async () => {
    const user = userEvent.setup()
    renderApp('/guardrails', { signedIn: false })
    expect(location()).toBe('/sign-in')
    expect(screen.getByRole('heading', { name: 'Sign in to AgentsOnRails.dev' })).toBeInTheDocument()
    await signIn(user)
    await waitFor(() => expect(location()).toBe('/guardrails'))
  })

  it('shows the Supabase error for a wrong password', async () => {
    const user = userEvent.setup()
    renderApp('/sessions', { signedIn: false })
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
    renderApp('/agents', { signedIn: false })
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
    expect(location()).toBe('/agents')
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
            <AppRoutes />
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

describe('sign-up', () => {
  it('creates an account and opens the app', async () => {
    const user = userEvent.setup()
    const { auth } = renderApp('/sign-up', { signedIn: false })
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'long-enough')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(location()).toBe('/agents'))
    expect(auth.session?.email).toBe('new@example.com')
  })

  it('asks to confirm the email when Supabase requires it', async () => {
    const user = userEvent.setup()
    renderApp('/sign-up', { signedIn: false })
    await user.type(screen.getByLabelText('Email'), CONFIRM_EMAIL)
    await user.type(screen.getByLabelText('Password'), 'long-enough')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText(CONFIRM_EMAIL)).toBeInTheDocument()
    expect(location()).toBe('/sign-up')
  })

  it('shows the Supabase error and needs 8 characters', async () => {
    const user = userEvent.setup()
    renderApp('/sign-up', { signedIn: false })
    await user.type(screen.getByLabelText('Email'), TAKEN_EMAIL)
    await user.type(screen.getByLabelText('Password'), 'short')
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled()
    await user.type(screen.getByLabelText('Password'), '-but-now-long')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('User already registered')
  })

  it('links sign-in and sign-up to each other', async () => {
    const user = userEvent.setup()
    renderApp('/sign-in', { signedIn: false })
    await user.click(screen.getByRole('link', { name: 'Create one' }))
    expect(location()).toBe('/sign-up')
    await user.click(screen.getByRole('link', { name: 'Sign in' }))
    expect(location()).toBe('/sign-in')
  })
})

describe('GitHub and Google', () => {
  it.each([
    ['Continue with GitHub', 'github'],
    ['Continue with Google', 'google'],
  ] as const)('%s starts the %s sign-in', async (label, provider) => {
    const user = userEvent.setup()
    const { auth } = renderApp('/sign-in', { signedIn: false })
    await user.click(screen.getByRole('button', { name: label }))
    expect(auth.oauthStarted).toEqual([provider])
    expect(screen.getByRole('button', { name: 'Redirecting…' })).toBeDisabled()
  })

  it('the callback opens the app once the session arrives', async () => {
    const { auth } = renderApp('/auth/callback?code=abc', { signedIn: false })
    act(() => auth.arriveAs('octocat@example.com'))
    await waitFor(() => expect(location()).toBe('/agents'))
  })

  it('the callback explains a failed sign-in', () => {
    renderApp('/auth/callback?error=access_denied&error_description=The+user+denied+access', { signedIn: false })
    expect(screen.getByRole('heading', { name: "Couldn't sign you in" })).toBeInTheDocument()
    expect(screen.getByText('The user denied access')).toBeInTheDocument()
  })
})

describe('password reset', () => {
  it('emails a reset link', async () => {
    const user = userEvent.setup()
    const { auth } = renderApp('/sign-in', { signedIn: false })
    await user.click(screen.getByRole('link', { name: 'Forgot password?' }))
    await user.type(screen.getByLabelText('Email'), DEMO_EMAIL)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(auth.resetEmails).toEqual([DEMO_EMAIL])
  })

  it('sets a new password from the emailed link', async () => {
    const user = userEvent.setup()
    const { auth } = renderApp('/reset-password')
    await user.type(screen.getByLabelText('New password'), 'brand-new-password')
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    await waitFor(() => expect(location()).toBe('/agents'))
    expect(auth.passwordUpdates).toEqual(['brand-new-password'])
  })

  it('explains an expired reset link', () => {
    renderApp('/reset-password', { signedIn: false })
    expect(screen.getByRole('heading', { name: 'Reset link expired' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Send a new one' })).toHaveAttribute('href', '/forgot-password')
  })
})

describe('first sign-in setup', () => {
  it('runs once per user and refetches what it added', async () => {
    fakeApi.bootstrap = { library: 'seeded', demo_agent: 'added' }
    const { queryClient } = renderApp('/agents')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await waitFor(() => expect(fakeApi.bootstrapCalls).toBe(1))
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
  })

  it('waits for a sign-in', async () => {
    const user = userEvent.setup()
    renderApp('/sign-in', { signedIn: false })
    expect(fakeApi.bootstrapCalls).toBe(0)
    await signIn(user)
    await waitFor(() => expect(fakeApi.bootstrapCalls).toBe(1))
  })
})
