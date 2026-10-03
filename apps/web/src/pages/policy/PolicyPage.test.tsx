import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakePiPolicy } from '../../test/fakePiPolicy'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

// The rule list card (label + Add button + rows) for one rule list, scoped to a card.
function listCard(label: string, scope: HTMLElement) {
  const group = within(scope).getByRole('group', { name: label })
  if (!(group instanceof HTMLElement)) throw new Error(`no group for ${label}`)
  return group
}

describe('PolicyPage', () => {
  it('renders global rules and per-agent overrides', async () => {
    renderApp('/policies', undefined, { mode: 'agent' })
    expect(await screen.findByRole('heading', { name: 'Global rules' })).toBeInTheDocument()
    expect(screen.getByText('applied to every agent')).toBeInTheDocument()
    expect(screen.getByText('overrides the global rules for this agent')).toBeInTheDocument()
    expect(screen.getByText('amir')).toBeInTheDocument()

    const defaults = screen.getByRole('region', { name: 'Global rules' })
    expect(within(defaults).getByText('ban-rm-rf')).toBeInTheDocument()
    // agent override lists its own rule
    const amir = screen.getByRole('region', { name: 'amir' })
    expect(within(amir).getByDisplayValue('0.5')).toBeInTheDocument()
  })

  it('adds a banned command through the UI and saves it', async () => {
    const user = userEvent.setup()
    renderApp('/policies', undefined, { mode: 'agent' })
    const defaults = await screen.findByRole('region', { name: 'Global rules' })
    const banned = listCard('Banned commands', defaults)

    await user.click(within(banned).getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText('Rule id'), 'ban-fork-bomb')
    await user.type(screen.getByLabelText(/^Pattern/), 'kill -9 *')
    await user.type(screen.getByLabelText(/Reason/), 'Fork bomb')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(within(defaults).getByText('ban-fork-bomb')).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes — remember to save.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('✓ Saved'))
    const rules = fakePiPolicy.policy.defaults?.commands?.banned ?? []
    expect(rules.some((r) => r.id === 'ban-fork-bomb' && r.reason === 'Fork bomb')).toBe(true)
  })

  it('rejects invalid rules client-side before saving', async () => {
    const user = userEvent.setup()
    renderApp('/policies', undefined, { mode: 'agent' })
    const defaults = await screen.findByRole('region', { name: 'Global rules' })
    const banned = listCard('Banned commands', defaults)

    await user.click(within(banned).getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText('Rule id'), 'Bad Id!')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(await screen.findByText(/lowercase letters, digits/i)).toBeInTheDocument()
    // form stays open and nothing was persisted
    expect(screen.getByLabelText('Rule id')).toBeInTheDocument()
    expect(fakePiPolicy.policy.defaults?.commands?.banned).toHaveLength(2)
  })

  it('shows server-side schema errors and keeps the draft', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(
        apiPath('/pi/policy/validate'),
        () =>
          HttpResponse.json({
            valid: false,
            errors: [{ jsonPath: '$.version', message: '1 was expected' }],
          }),
        { once: true },
      ),
    )
    renderApp('/policies', undefined, { mode: 'agent' })
    const defaults = await screen.findByRole('region', { name: 'Global rules' })
    const banned = listCard('Banned commands', defaults)

    await user.click(within(banned).getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText('Rule id'), 'ban-x')
    await user.type(screen.getByLabelText(/^Pattern/), 'x')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Schema validation failed')
    expect(within(alert).getByText('$.version')).toBeInTheDocument()
    // draft is kept so the user can fix it
    expect(within(defaults).getByText('ban-x')).toBeInTheDocument()
  })

  it('shows the stale-save warning and reloads on 412', async () => {
    const user = userEvent.setup()
    server.use(
      http.put(
        apiPath('/pi/policy'),
        () =>
          HttpResponse.json(
            { detail: { message: 'policy changed since you read it', currentSha256: 'new' } },
            { status: 412 },
          ),
        { once: true },
      ),
    )
    renderApp('/policies', undefined, { mode: 'agent' })
    const defaults = await screen.findByRole('region', { name: 'Global rules' })
    const banned = listCard('Banned commands', defaults)

    await user.click(within(banned).getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText('Rule id'), 'ban-x')
    await user.type(screen.getByLabelText(/^Pattern/), 'x')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/changed on disk since you loaded it/i)
    await user.click(within(alert).getByRole('button', { name: 'Reload now' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('disables and re-enables a rule', async () => {
    const user = userEvent.setup()
    renderApp('/policies', undefined, { mode: 'agent' })
    const defaults = await screen.findByRole('region', { name: 'Global rules' })
    const banned = listCard('Banned commands', defaults)
    const row = within(banned).getByText('ban-rm-rf').closest('div') as HTMLElement

    await user.click(within(row).getByRole('button', { name: 'Enabled' }))
    expect(within(row).getByRole('button', { name: 'Disabled' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Unsaved changes — remember to save.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('✓ Saved'))
    const rule = (fakePiPolicy.policy.defaults?.commands?.banned ?? []).find((r) => r.id === 'ban-rm-rf')
    expect(rule?.enabled).toBe(false)
  })

  it('removes an agent override with a two-step confirmation', async () => {
    const user = userEvent.setup()
    renderApp('/policies', undefined, { mode: 'agent' })
    await screen.findByRole('region', { name: 'amir' })

    await user.click(screen.getByRole('button', { name: 'Remove override' }))
    expect(screen.getByRole('button', { name: 'Confirm remove' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: 'amir' })).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fakePiPolicy.policy.agents?.amir).toBeUndefined())
  })

  it('adds an agent override', async () => {
    const user = userEvent.setup()
    renderApp('/policies', undefined, { mode: 'agent' })
    await screen.findByRole('region', { name: 'Global rules' })
    await user.type(screen.getByLabelText('Add an agent override'), 'new-host')
    await user.click(screen.getByRole('button', { name: 'Add override' }))
    expect(screen.getByRole('region', { name: 'new-host' })).toBeInTheDocument()
    expect(fakePiPolicy.policy.agents?.['new-host']).toBeUndefined() // not saved yet
  })
})
