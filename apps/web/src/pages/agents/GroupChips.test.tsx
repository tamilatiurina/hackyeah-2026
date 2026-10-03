import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../../test/renderApp'

async function openNewGroup() {
  const user = userEvent.setup()
  renderApp('/agents')
  await screen.findByRole('link', { name: 'Support Assistant' })
  await user.click(screen.getByRole('button', { name: 'New group' }))
  return user
}

describe('New group', () => {
  it('creates a group and selects it', async () => {
    const user = await openNewGroup()
    await user.type(screen.getByLabelText('Group name'), 'Finance')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // The chip renders from the cache update a moment before the URL selection lands.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Finance' })).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByTestId('location').textContent).toBe('/agents?group=finance')
    expect(screen.getByText('No agents in this group yet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Group name')).not.toBeInTheDocument()
  })

  it('shows the duplicate-name error and keeps the form open', async () => {
    const user = await openNewGroup()
    await user.type(screen.getByLabelText('Group name'), 'legal')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('A group with this name already exists')).toBeInTheDocument()
    expect(screen.getByLabelText('Group name')).toBeInTheDocument()
  })

  it('cancels without creating anything', async () => {
    const user = await openNewGroup()
    await user.type(screen.getByLabelText('Group name'), 'Finance')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Finance' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New group' })).toBeInTheDocument()
  })

  it('disables Save until a name is typed', async () => {
    await openNewGroup()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
