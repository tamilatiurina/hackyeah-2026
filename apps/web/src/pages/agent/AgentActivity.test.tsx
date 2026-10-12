import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const events = () => within(screen.getByRole('region', { name: 'Audit events' }))
const eventRows = () => events().getAllByRole('row').slice(1)

async function open(id = 'agent-support') {
  const user = userEvent.setup()
  renderApp(`/agents/${id}/activity`)
  await screen.findByRole('region', { name: /^Sessions/ })
  return user
}

describe('Agent activity', () => {
  it("lists only this agent's sessions and events", async () => {
    await open()
    const sessions = within(screen.getByRole('region', { name: /^Sessions/ }))
    expect(sessions.getByText('2 total · 1 active · $0.0000')).toBeInTheDocument()
    expect(sessions.getByText('Session token cap reached')).toBeInTheDocument()
    expect(eventRows()).toHaveLength(4)
    expect(events().queryByText('Phone number')).not.toBeInTheDocument() // agent-contracts
    expect(fakeApi.auditRequests.every((url) => url.searchParams.get('agent_id') === 'agent-support')).toBe(true)
  })

  it('filters events by action and by session', async () => {
    const user = await open()
    await user.click(events().getByRole('button', { name: /^Redact/ }))
    expect(eventRows()).toHaveLength(2)
    await user.click(events().getByRole('button', { name: /^All/ }))
    await user.click(screen.getByRole('button', { name: 'ctx-stopped' }))
    expect(eventRows()).toHaveLength(2)
    expect(events().getByText('Session token cap reached')).toBeInTheDocument()
    await user.click(events().getByRole('button', { name: 'Clear session filter' }))
    expect(eventRows()).toHaveLength(4)
  })

  it('invites going live when there is no traffic', async () => {
    fakeApi.sessions = []
    fakeApi.auditEvents = []
    renderApp('/agents/agent-support/activity')
    expect(await screen.findByText('No traffic yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go live' })).toHaveAttribute('href', '/agents/agent-support/deploy')
  })
})
