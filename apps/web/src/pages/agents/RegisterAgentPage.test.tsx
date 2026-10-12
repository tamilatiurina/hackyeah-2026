import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { cardUnreachable, fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const location = () => screen.getByTestId('location').textContent
const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Register and continue' }))

async function open() {
  const user = userEvent.setup()
  renderApp('/agents/new')
  await screen.findByRole('heading', { level: 1, name: 'Register an agent' })
  return user
}

describe('RegisterAgentPage', () => {
  it('shows the setup steps and where the Agent Card is read from', async () => {
    const user = await open()
    expect(screen.getByRole('list', { name: 'Setup steps' })).toHaveTextContent('Connect')
    await user.type(screen.getByLabelText('Agent URL'), 'https://bot.acme.example/')
    expect(screen.getByText('https://bot.acme.example/.well-known/agent-card.json')).toBeInTheDocument()
  })

  it('registers from the Agent Card alone and continues to the guardrails step', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Agent URL'), 'https://bot.acme.example')
    await submit(user)
    await waitFor(() => expect(location()).toBe('/agents/agent-new-1/guardrails'))
    expect(fakeApi.lastAgentRegistration).toEqual({ base_url: 'https://bot.acme.example', auth_header: null })
    expect(await screen.findByRole('heading', { level: 1, name: 'Card Agent' })).toBeInTheDocument()
    expect(screen.getAllByRole('status').find((el) => el.textContent)).toHaveTextContent(
      'Card Agent registered. Agent Card v1.0.0 · 1 skill. Next: attach guardrails.',
    )
  })

  it('sends the name, description and auth header when given', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Agent URL'), 'https://bot.acme.example')
    await user.type(screen.getByLabelText('Name (optional)'), 'Billing Bot')
    await user.type(screen.getByLabelText('Description (optional)'), 'Answers billing questions.')
    await user.click(screen.getByLabelText('Send an auth header to the agent'))
    await user.type(screen.getByLabelText('Header value'), 'Bearer s3cret')
    await submit(user)
    await waitFor(() => expect(location()).toBe('/agents/agent-new-1/guardrails'))
    expect(fakeApi.lastAgentRegistration).toEqual({
      name: 'Billing Bot',
      description: 'Answers billing questions.',
      base_url: 'https://bot.acme.example',
      auth_header: { name: 'Authorization', value: 'Bearer s3cret' },
    })
  })

  it('validates before calling the API', async () => {
    const user = await open()
    await user.click(screen.getByLabelText('Send an auth header to the agent'))
    await submit(user)
    expect(screen.getByText('Agent URL is required')).toBeInTheDocument()
    expect(screen.getByText('Header value is required')).toBeInTheDocument()
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument()
    expect(fakeApi.lastAgentRegistration).toBeNull()
  })

  it('explains an agent without a readable Agent Card and stays on the page', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Agent URL'), 'https://x.unreachable.example')
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(cardUnreachable('https://x.unreachable.example'))
    expect(location()).toBe('/agents/new')
  })

  it('shows a duplicate name under Name', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Agent URL'), 'https://bot.acme.example')
    await user.type(screen.getByLabelText('Name (optional)'), 'Support Assistant')
    await submit(user)
    expect(await screen.findByText('An agent with this name already exists')).toBeInTheDocument()
    expect(screen.getByLabelText('Name (optional)')).toHaveAttribute('aria-invalid', 'true')
  })

  it('cancels back to the agents list', async () => {
    await open()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/agents')
  })
})
