import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function open() {
  const user = userEvent.setup()
  renderApp('/agents/agent-support')
  await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
  return user
}

describe('Delete agent', () => {
  it('asks for confirmation, deletes and returns to the list', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/agents'))
    expect(await screen.findByRole('link', { name: 'Contract Summarizer' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Support Assistant' })).not.toBeInTheDocument()
    expect(screen.queryByText('Agent not found')).not.toBeInTheDocument()
    expect(fakeApi.agents.map((a) => a.id)).toEqual(['agent-contracts'])
  })

  it('forgets the deleted agent so Back does not show it again', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderApp('/agents/agent-support')
    await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/agents'))
    await waitFor(() => expect(queryClient.getQueryData(['agents', 'agent-support'])).toBeUndefined())
  })

  it('cancels when focus moves away', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(fakeApi.agents).toHaveLength(2)
  })

  it('says deleting is not available yet on a 405', async () => {
    fakeApi.agentsSupport.delete = false
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(await screen.findByText("Deleting agents isn't available on this API yet.")).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/agents/agent-support')
  })
})
