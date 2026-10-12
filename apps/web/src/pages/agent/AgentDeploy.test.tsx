import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const toast = () => screen.getAllByRole('status').find((el) => el.textContent)

async function open(path = '/agents/agent-support/deploy') {
  const user = userEvent.setup()
  renderApp(path)
  await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
  return user
}

describe('Agent go live step', () => {
  it('lists pre-flight checks with links to unfinished steps', async () => {
    await open()
    const checks = within(await screen.findByRole('list', { name: 'Pre-flight checks' }))
    await waitFor(() => expect(checks.getByText('1 mandatory · 1 attached')).toBeInTheDocument())
    expect(checks.getByText('Not tested yet.')).toBeInTheDocument()
    expect(checks.getByRole('link', { name: 'Run a test' })).toHaveAttribute('href', '/agents/agent-support/test')
    expect(checks.getByRole('link', { name: 'Choose tools' })).toHaveAttribute('href', '/agents/agent-support/mcp')
    expect(screen.getByText('1 warning. You can go live anyway.')).toBeInTheDocument()
  })

  it('creates a key, shows it once and puts it in the first call', async () => {
    const user = await open()
    await user.click(await screen.findByRole('button', { name: 'Create gateway key' }))
    const live = within(await screen.findByRole('region', { name: /^Live/ }))
    expect(live.getByText('ghk_test_1')).toBeInTheDocument()
    expect(live.getByText("Copy the key now. It won't be shown again.")).toBeInTheDocument()
    expect(live.getByText(/X-API-Key: ghk_test_1/)).toBeInTheDocument()
    const origin = window.location.origin
    expect(live.getByText(`${origin}/a/agent-support`)).toBeInTheDocument()
    expect(live.getByText(`${origin}/a/agent-support/.well-known/agent-card.json`)).toBeInTheDocument()
    expect(fakeApi.gatewayKeys['agent-support']).toBe('ghk_test_1')
    expect(screen.getByText('Live', { selector: 'span' })).toBeInTheDocument() // the status pill

    await user.click(live.getByRole('button', { name: 'Copy key' }))
    expect(await navigator.clipboard.readText()).toBe('ghk_test_1')
    await waitFor(() => expect(toast()).toHaveTextContent('Key copied.'))
  })

  it('rotates the key after confirmation', async () => {
    fakeApi.agents[0] = { ...fakeApi.agents[0], has_gateway_key: true }
    const user = await open()
    expect(await screen.findByText('•••• (shown once when created)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rotate…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fakeApi.gatewayKeys['agent-support']).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Rotate…' }))
    await user.click(screen.getByRole('button', { name: 'Rotate now' }))
    expect(await screen.findByText('ghk_test_1')).toBeInTheDocument()
    await waitFor(() => expect(toast()).toHaveTextContent('Key rotated. The old key no longer works.'))
  })

  it('takes the agent offline by revoking its key', async () => {
    fakeApi.agents[0] = { ...fakeApi.agents[0], has_gateway_key: true }
    fakeApi.gatewayKeys['agent-support'] = 'ghk_old'
    const user = await open()
    await user.click(await screen.findByRole('button', { name: 'Take offline…' }))
    await user.click(screen.getByRole('button', { name: 'Revoke key' }))
    expect(await screen.findByRole('button', { name: 'Create gateway key' })).toBeInTheDocument()
    expect(fakeApi.gatewayKeys['agent-support']).toBeUndefined()
    expect(fakeApi.agents[0].has_gateway_key).toBe(false)
    await waitFor(() => expect(toast()).toHaveTextContent('Support Assistant is offline. The guarded URL now returns 401.'))
  })

  it("shows the API's message when the key can't be saved", async () => {
    server.use(
      http.post(apiPath('/agents/:id/gateway-key'), () =>
        HttpResponse.json({ detail: 'Could not save the gateway key' }, { status: 503 }),
      ),
    )
    const user = await open()
    await user.click(await screen.findByRole('button', { name: 'Create gateway key' }))
    await waitFor(() => expect(toast()).toHaveTextContent('Could not save the gateway key'))
  })
})
