import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { RUNTIME_NAME_HINT } from '../../api/validation'
import { renderApp } from '../../test/renderApp'

async function openForm(path = '/agents') {
  const user = userEvent.setup()
  renderApp(path)
  await user.click(await screen.findByRole('button', { name: 'Register agent' }))
  return user
}

const unreachableMessage = "Can't reach https://billing.unreachable.test: host not found"

describe('Register agent — proxy', () => {
  it('reports a reachable connection', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Upstream URL'), 'https://billing.acme.internal/chat')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText(/^Reachable · \d+ ms$/)).toBeInTheDocument()
  })

  it('reports an unreachable connection', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Upstream URL'), 'https://billing.unreachable.test')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText(unreachableMessage)).toBeInTheDocument()
  })

  it('refuses to register an unreachable URL and keeps the form open', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Name'), 'Billing Bot')
    await user.type(screen.getByLabelText('Upstream URL'), 'https://billing.unreachable.test')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText(unreachableMessage)).toBeInTheDocument()
    expect(screen.getByLabelText('Upstream URL')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('link', { name: 'Billing Bot' })).not.toBeInTheDocument()
  })

  it('registers a proxy agent, closes the form and highlights the new row', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Name'), 'Billing Bot')
    await user.type(screen.getByLabelText('Upstream URL'), 'https://billing.acme.internal/chat')
    await user.selectOptions(screen.getByLabelText('Group'), 'Legal')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    const link = await screen.findByRole('link', { name: 'Billing Bot' })
    const row = link.closest('tr') as HTMLElement
    expect(row).toHaveAttribute('data-highlight', 'true')
    expect(within(row).getByText('Draft')).toBeInTheDocument()
    expect(within(row).getByText('Legal')).toBeInTheDocument()
    expect(screen.queryByLabelText('Upstream URL')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Register agent' })).toBeInTheDocument()
  })

  it('trims a pasted URL with surrounding spaces', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Name'), 'Billing Bot')
    await user.type(screen.getByLabelText('Upstream URL'), '  https://billing.acme.internal/chat  ')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText(/^Reachable · \d+ ms$/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Register' }))
    const row = (await screen.findByRole('link', { name: 'Billing Bot' })).closest('tr') as HTMLElement
    expect(within(row).getByText('https://billing.acme.internal/chat')).toBeInTheDocument()
  })

  it('shows field errors before calling the server', async () => {
    const user = await openForm()
    await user.clear(screen.getByLabelText('Owner'))
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Upstream URL is required')).toBeInTheDocument()
    expect(screen.getByText('Owner is required')).toBeInTheDocument()
  })

  it('shows the duplicate-name error from the server under Name', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Name'), 'support assistant')
    await user.type(screen.getByLabelText('Upstream URL'), 'https://x.acme.internal')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText('An agent with this name already exists')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('defaults the group to the selected chip', async () => {
    await openForm('/agents?group=people')
    expect(screen.getByLabelText('Group')).toHaveValue('people')
  })

  it('closes on Cancel', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })
})

describe('Register agent — runtime', () => {
  it('clears stale URL errors and connection results when switching to Runtime', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Upstream URL'), 'https://billing.unreachable.test')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    await screen.findByText(unreachableMessage)
    await user.click(screen.getByRole('button', { name: 'Register' }))
    await user.click(screen.getByRole('button', { name: /Runtime agent/ }))
    expect(screen.queryByText(unreachableMessage)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Upstream URL')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Test connection' })).not.toBeInTheDocument()
  })

  it('rejects a name that cannot be AGENT_NAME', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: /Runtime agent/ }))
    await user.type(screen.getByLabelText('Name'), 'Billing Bot')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(screen.getByText(RUNTIME_NAME_HINT)).toBeInTheDocument()
  })

  it('shows the start command for the typed name before registering', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: /Runtime agent/ }))
    expect(screen.getByText(/AGENT_NAME=<name> POLICY_PATH=/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Name'), 'billing-bot')
    expect(screen.getByText(/AGENT_NAME=billing-bot POLICY_PATH=/)).toBeInTheDocument()
  })

  it('registers and keeps the start command on screen until Done', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: /Runtime agent/ }))
    await user.type(screen.getByLabelText('Name'), 'billing-bot')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByRole('heading', { name: 'billing-bot registered' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'AGENT_NAME=billing-bot POLICY_PATH=packages/pi-control-layer/policy.json pi -e packages/pi-control-layer/control-layer.ts',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('ws://localhost:4747')).toBeInTheDocument()
    const row = screen.getByRole('link', { name: 'billing-bot' }).closest('tr') as HTMLElement
    expect(within(row).getByText('Offline')).toBeInTheDocument()
    expect(within(row).getByText('WebSocket · never connected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('heading', { name: 'billing-bot registered' })).not.toBeInTheDocument()
  })
})
