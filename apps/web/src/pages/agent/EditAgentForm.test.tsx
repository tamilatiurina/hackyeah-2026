import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { cardUnreachable, fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function openEdit(id = 'agent-support') {
  const user = userEvent.setup()
  renderApp(`/agents/${id}`)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  return user
}

const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Save changes' }))

describe('Edit agent', () => {
  it('opens with the current values and focus on Name', async () => {
    await openEdit()
    expect(screen.getByLabelText('Name')).toHaveValue('Support Assistant')
    expect(screen.getByLabelText('Name')).toHaveFocus()
    expect(screen.getByLabelText('Agent URL')).toHaveValue('https://support-agent.acme.example')
    expect(screen.queryByLabelText('Response format')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Keep current')).toBeChecked()
  })

  it('sends only the changed fields and shows the result', async () => {
    const user = await openEdit()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Support Bot')
    await user.clear(screen.getByLabelText('Agent URL'))
    await user.type(screen.getByLabelText('Agent URL'), 'https://support-v2.acme.example')
    await save(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Bot' })).toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toEqual({ name: 'Support Bot', base_url: 'https://support-v2.acme.example' })
    expect(
      within(screen.getByRole('region', { name: 'Overview' })).getByText('https://support-v2.acme.example'),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus())
  })

  it('closes without a request when nothing changed', async () => {
    const user = await openEdit()
    await save(user)
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toBeNull()
  })

  it('replaces the auth header without showing the old value', async () => {
    const user = await openEdit()
    await user.click(screen.getByLabelText('Replace'))
    expect(screen.getByLabelText('Header name')).toHaveValue('Authorization')
    expect(screen.getByLabelText('Header value')).toHaveValue('')
    expect(screen.getByLabelText('Header value')).toHaveAttribute('type', 'password')
    await user.type(screen.getByLabelText('Header value'), 'Bearer new')
    await save(user)
    await screen.findByRole('region', { name: 'Overview' })
    expect(fakeApi.lastAgentUpdate).toEqual({ auth_header: { name: 'Authorization', value: 'Bearer new' } })
    expect(screen.queryByText(/Bearer new/)).not.toBeInTheDocument()
  })

  it('removes the auth header', async () => {
    const user = await openEdit()
    await user.click(screen.getByLabelText('Remove'))
    await save(user)
    const overview = await screen.findByRole('region', { name: 'Overview' })
    expect(within(overview).getByText('None')).toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toEqual({ auth_header: null })
  })

  it('adds an auth header to an agent without one', async () => {
    const user = await openEdit('agent-contracts')
    expect(screen.getByLabelText('None')).toBeChecked()
    expect(screen.queryByLabelText('Keep current')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Add'))
    await user.clear(screen.getByLabelText('Header name'))
    await user.type(screen.getByLabelText('Header name'), 'X-Api-Key')
    await user.type(screen.getByLabelText('Header value'), 'k')
    await save(user)
    await screen.findByRole('region', { name: 'Overview' })
    expect(fakeApi.lastAgentUpdate).toEqual({ auth_header: { name: 'X-Api-Key', value: 'k' } })
  })

  it('shows a duplicate name under Name', async () => {
    const user = await openEdit()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Contract Summarizer')
    await save(user)
    expect(await screen.findByText('An agent with this name already exists')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('explains a new URL without a readable Agent Card', async () => {
    const user = await openEdit()
    await user.clear(screen.getByLabelText('Agent URL'))
    await user.type(screen.getByLabelText('Agent URL'), 'https://x.unreachable.example/')
    await save(user)
    expect(await screen.findByText(cardUnreachable('https://x.unreachable.example/'))).toBeInTheDocument()
  })

  it('validates before calling the API', async () => {
    const user = await openEdit()
    await user.clear(screen.getByLabelText('Name'))
    await user.click(screen.getByLabelText('Replace'))
    await save(user)
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Header value is required')).toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toBeNull()
  })

  it('says editing is not available yet on a 405', async () => {
    fakeApi.agentsSupport.update = false
    const user = await openEdit()
    await user.type(screen.getByLabelText('Description'), ' More.')
    await save(user)
    expect(await screen.findByText("Editing agents isn't available on this API yet.")).toBeInTheDocument()
  })

  it('cancels and returns focus to Edit', async () => {
    const user = await openEdit()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
  })
})
