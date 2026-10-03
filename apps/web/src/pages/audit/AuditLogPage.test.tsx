import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const table = () => screen.findByRole('region', { name: 'Audit events table' })
const rows = () => within(screen.getByRole('region', { name: 'Audit events table' })).getAllByRole('row').slice(1)
const location = () => screen.getByTestId('location').textContent

describe('Audit log', () => {
  it('lists events newest first with rule, result and details', async () => {
    renderApp('/audit')
    await table()
    expect(rows()).toHaveLength(5)
    const first = rows()[0]
    expect(within(first).getByText('Session tokens')).toBeInTheDocument()
    expect(within(first).getByText('Limit')).toBeInTheDocument()
    expect(within(first).getByText('Block')).toBeInTheDocument()
    expect(within(first).getByText('Support Assistant')).toBeInTheDocument()
    expect(within(first).getByText('Session token cap reached')).toBeInTheDocument()
  })

  it('combines filters and keeps them in the URL', async () => {
    const user = userEvent.setup()
    renderApp('/audit')
    await table()
    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-support')
    await screen.findByRole('option', { name: 'PII' }) // rules load separately
    await user.selectOptions(screen.getByLabelText('Rule'), 'g-pii')
    await user.selectOptions(screen.getByLabelText('Result'), 'redact')
    await screen.findByText('Card number')
    expect(rows()).toHaveLength(2)
    expect(location()).toBe('/audit?agent_id=agent-support&rule_id=g-pii&action=redact')
    const last = fakeApi.auditRequests.at(-1)
    expect(last?.searchParams.get('rule_id')).toBe('g-pii')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(location()).toBe('/audit')
    expect(await screen.findByText('Phone number')).toBeInTheDocument()
  })

  it('shows a session filter as a removable chip', async () => {
    const user = userEvent.setup()
    renderApp('/audit?context_id=ctx-active')
    await screen.findByText('Card number')
    expect(rows()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Remove session filter ctx-active' }))
    expect(location()).toBe('/audit')
  })

  it('loads more pages', async () => {
    fakeApi.auditPageSize = 2
    const user = userEvent.setup()
    renderApp('/audit')
    await table()
    expect(rows()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Phone number')
    expect(rows()).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Card number')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('has empty states with and without filters', async () => {
    fakeApi.auditEvents = []
    renderApp('/audit')
    expect(await screen.findByText('No audit events yet. Blocks, redactions, warnings and limit hits appear here.')).toBeInTheDocument()
  })

  it('says when no event matches', async () => {
    renderApp('/audit?context_id=nope')
    expect(await screen.findByText('No events match these filters.')).toBeInTheDocument()
  })

  it('explains a missing audit API', async () => {
    fakeApi.auditSupported = false
    renderApp('/audit')
    expect(await screen.findByText("The audit API isn't available on this server yet (A-07).")).toBeInTheDocument()
  })
})
