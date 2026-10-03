import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function openForm() {
  const user = userEvent.setup()
  renderApp('/agents')
  await user.click(await screen.findByRole('button', { name: 'Register agent' }))
  return user
}

async function fill(user: ReturnType<typeof userEvent.setup>, name: string, url: string) {
  await user.type(screen.getByLabelText('Name'), name)
  await user.type(screen.getByLabelText('Upstream URL'), url)
}

describe('Register agent', () => {
  it('moves focus to Name when it opens', async () => {
    await openForm()
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })

  it('registers an agent, closes, highlights the row and returns focus', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.example/chat')
    await user.type(screen.getByLabelText('Description'), 'Answers invoices')
    await user.selectOptions(screen.getByLabelText('Response format'), 'Text')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    const row = (await screen.findByRole('link', { name: 'Billing Bot' })).closest('tr') as HTMLElement
    expect(row).toHaveAttribute('data-highlight', 'true')
    expect(within(row).getByText('JSON → Text')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Register agent' })).toHaveFocus())
    expect(fakeApi.lastAgentRegistration).toEqual({
      name: 'Billing Bot',
      description: 'Answers invoices',
      upstream_url: 'https://billing.example/chat',
      auth_header: null,
      request_format: 'json',
      response_format: 'text',
    })
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
    expect(screen.getByText('Upstream URL is required')).toBeInTheDocument()
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

  it('explains an unreachable upstream', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.unreachable.example/chat')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(
      await screen.findByText("Couldn't reach the upstream agent. Check the URL and that it answers GET requests."),
    ).toBeInTheDocument()
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
