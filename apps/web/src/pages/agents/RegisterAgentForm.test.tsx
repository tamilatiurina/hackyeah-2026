import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { cardUnreachable, fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function openForm() {
  const user = userEvent.setup()
  renderApp('/agents')
  await user.click(await screen.findByRole('button', { name: 'Register agent' }))
  return user
}

async function fill(user: ReturnType<typeof userEvent.setup>, name: string, url: string) {
  await user.type(screen.getByLabelText('Name'), name)
  await user.type(screen.getByLabelText('Agent URL'), url)
}

describe('Register agent', () => {
  it('moves focus to Name when it opens', async () => {
    await openForm()
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })

  it('registers an agent, closes, highlights the row and returns focus', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.example')
    await user.type(screen.getByLabelText('Description'), 'Answers invoices')
    expect(screen.queryByLabelText('Request format')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Register' }))
    const row = (await screen.findByRole('link', { name: 'Billing Bot' })).closest('tr') as HTMLElement
    expect(row).toHaveAttribute('data-highlight', 'true')
    expect(within(row).getByText('v1.0.0 · 1 skill')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Register agent' })).toHaveFocus())
    expect(fakeApi.lastAgentRegistration).toEqual({
      name: 'Billing Bot',
      description: 'Answers invoices',
      base_url: 'https://billing.example',
      auth_header: null,
    })
  })

  it('leaves a blank description to the Agent Card', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.example')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    const row = (await screen.findByRole('link', { name: 'Billing Bot' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Billing Bot (from its Agent Card).')).toBeInTheDocument()
    expect(fakeApi.lastAgentRegistration).not.toHaveProperty('description')
  })

  it('sends an auth header when asked, without showing its value afterwards', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.example/chat')
    expect(screen.queryByLabelText('Header value')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Send an auth header'))
    expect(screen.getByLabelText('Header name')).toHaveValue('Authorization')
    expect(screen.getByLabelText('Header value')).toHaveAttribute('type', 'password')
    await user.type(screen.getByLabelText('Header value'), 'Bearer s3cret')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    const row = (await screen.findByRole('link', { name: 'Billing Bot' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Authorization')).toBeInTheDocument()
    expect(screen.queryByText(/s3cret/)).not.toBeInTheDocument()
    expect(fakeApi.lastAgentRegistration?.auth_header).toEqual({ name: 'Authorization', value: 'Bearer s3cret' })
  })

  it('checks fields before calling the API', async () => {
    const user = await openForm()
    await user.click(screen.getByLabelText('Send an auth header'))
    await user.clear(screen.getByLabelText('Header name'))
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Agent URL is required')).toBeInTheDocument()
    expect(screen.getByText('Header name is required')).toBeInTheDocument()
    expect(screen.getByText('Header value is required')).toBeInTheDocument()
    expect(fakeApi.lastAgentRegistration).toBeNull()
  })

  it('shows a duplicate name under Name', async () => {
    const user = await openForm()
    await fill(user, 'Support Assistant', 'https://billing.example/chat')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText('An agent with this name already exists')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('explains why the Agent Card could not be read', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.unreachable.example')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText(cardUnreachable('https://billing.unreachable.example'))).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('does not report an auth-header error as a Name error', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.example/chat')
    await user.click(screen.getByLabelText('Send an auth header'))
    await user.clear(screen.getByLabelText('Header name'))
    await user.type(screen.getByLabelText('Header name'), 'Bad Header')
    await user.type(screen.getByLabelText('Header value'), 'x')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText('auth header name is not a valid HTTP header name')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false')
  })

  it('closes on Cancel and returns focus', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Register agent' })).toHaveFocus()
  })
})
