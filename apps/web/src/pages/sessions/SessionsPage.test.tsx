import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const table = () => screen.findByRole('region', { name: 'Sessions table' })
const row = (contextId: string) => screen.getByRole('row', { name: new RegExp(contextId) })

describe('Sessions', () => {
  it('shows each session with counters and status', async () => {
    renderApp('/sessions')
    await table()
    const active = row('ctx-active')
    expect(within(active).getByRole('link', { name: 'Support Assistant' })).toHaveAttribute('href', '/agents/agent-support')
    expect(within(active).getByText('3')).toBeInTheDocument()
    expect(within(active).getByText('90 / 75')).toBeInTheDocument()
    expect(within(active).getByText('3m 0s')).toBeInTheDocument()
    expect(within(active).getByText('Active')).toBeInTheDocument()
  })

  it('shows a session that hit a limit as stopped, with the reason and its meters', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await table()
    const stopped = row('ctx-stopped')
    expect(within(stopped).getByText('Stopped')).toBeInTheDocument()
    expect(within(stopped).getByText('Session token cap reached')).toBeInTheDocument()
    await user.click(within(stopped).getByRole('button', { name: 'Show limits for ctx-stopped' }))
    expect(screen.getByRole('progressbar', { name: 'Session tokens' })).toHaveAttribute('value', '10000')
    expect(screen.getByText('Session tokens: 10000 / 10000 tokens')).toBeInTheDocument()
    expect(within(row('ctx-active')).queryByRole('button', { name: /Show limits/ })).not.toBeInTheDocument()
  })

  it('filters by agent and status', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await table()
    await user.selectOptions(screen.getByLabelText('Status'), 'stopped')
    await screen.findByText('Session token cap reached')
    expect(screen.queryByRole('row', { name: /ctx-active/ })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Status'), '')
    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-contracts')
    await screen.findByRole('row', { name: /ctx-contracts/ })
    expect(screen.queryByRole('row', { name: /ctx-stopped/ })).not.toBeInTheDocument()
  })

  it('opens the audit log filtered to a session', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await table()
    await user.click(within(row('ctx-active')).getByRole('link', { name: '2 events' }))
    expect(screen.getByTestId('location').textContent).toBe('/audit?context_id=ctx-active')
    expect(await screen.findByText('Card number')).toBeInTheDocument()
  })

  it('loads more sessions', async () => {
    fakeApi.auditPageSize = 2
    const user = userEvent.setup()
    renderApp('/sessions')
    await table()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('row', { name: /ctx-active/ })).toBeInTheDocument()
  })

  it('has an empty state', async () => {
    fakeApi.sessions = []
    renderApp('/sessions')
    expect(await screen.findByText("No sessions yet. Calls through an agent's guarded URL show up here.")).toBeInTheDocument()
  })

  it('explains a missing audit API', async () => {
    fakeApi.auditSupported = false
    renderApp('/sessions')
    expect(await screen.findByText("The audit API isn't available on this server yet (A-07).")).toBeInTheDocument()
  })

  it('is not available to testers', () => {
    renderApp('/sessions', 'tester')
    expect(screen.getByTestId('location').textContent).toBe('/test')
  })
})
