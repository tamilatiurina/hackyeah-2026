import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../api/client'
import { ANONYMOUS_DISABLED, TEST_TOKEN } from '../test/fakeAuth'
import { renderApp } from '../test/renderApp'
import { server } from '../test/server'

const location = () => screen.getByTestId('location').textContent

describe('guest sessions', () => {
  it('starts a guest session instead of showing the sign-in page', async () => {
    const seen: (string | null)[] = []
    server.use(
      http.get(apiPath('/agents'), ({ request }) => {
        seen.push(request.headers.get('Authorization'))
        return HttpResponse.json({ data: [], total: 0 })
      }),
    )
    const { auth } = renderApp('/agents', undefined, { signedIn: false, guest: true })
    expect(await screen.findByText('No agents yet. Register your first one.')).toBeInTheDocument()
    expect(location()).toBe('/agents')
    expect(screen.queryByRole('heading', { name: 'Sign in to Guardrail Hub' })).not.toBeInTheDocument()
    expect(auth.session?.anonymous).toBe(true)
    expect(seen[0]).toBe(`Bearer ${TEST_TOKEN}`)
  })

  it('shows a guest label and no Sign out for guests', async () => {
    renderApp('/fleet', undefined, { signedIn: false, guest: true })
    expect(await screen.findByText('Guest session')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('falls back to the sign-in page when anonymous sign-ins are disabled', async () => {
    renderApp('/agents', undefined, { signedIn: false, guest: true, anonymousEnabled: false })
    await waitFor(() => expect(location()).toBe('/sign-in'))
    expect(await screen.findByText(`Couldn't start a guest session: ${ANONYMOUS_DISABLED}`)).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('starts a new guest session when the old one can no longer be refreshed', async () => {
    let calls = 0
    server.use(
      http.get(apiPath('/agents'), () => {
        calls += 1
        return calls <= 2
          ? HttpResponse.json({ detail: 'Invalid Supabase access token' }, { status: 401 })
          : HttpResponse.json({ data: [], total: 0 })
      }),
    )
    const { auth } = renderApp('/agents', undefined, { signedIn: false, guest: true })
    auth.refreshSession = async () => null // the guest's refresh token is gone
    expect(await screen.findByText('No agents yet. Register your first one.')).toBeInTheDocument()
    expect(location()).toBe('/agents')
  })
})
