import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { db } from '../../mocks/db'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'
import { apiPath } from '../../api/client'

describe('Register agent availability', () => {
  it('offers Register only once agents and groups have loaded', async () => {
    server.use(
      http.get(apiPath('/groups'), async () => {
        await delay(150)
        return HttpResponse.json(db.groups)
      }),
    )
    renderApp('/agents')
    expect(screen.queryByRole('button', { name: 'Register agent' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Register agent' })).toBeInTheDocument()
  })

  it('hides Register while the list failed to load', async () => {
    server.use(http.get(apiPath('/agents'), () => HttpResponse.json({ message: 'boom' }, { status: 500 })))
    renderApp('/agents')
    await screen.findByText("Couldn't load agents.")
    expect(screen.queryByRole('button', { name: 'Register agent' })).not.toBeInTheDocument()
  })
})

describe('Register agent focus', () => {
  it('moves focus to Name on open and back to Register agent on Cancel', async () => {
    const user = userEvent.setup()
    renderApp('/agents')
    await user.click(await screen.findByRole('button', { name: 'Register agent' }))
    expect(screen.getByLabelText('Name')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Register agent' })).toHaveFocus()
  })

  it('focuses the done heading after a runtime registration and returns focus on Done', async () => {
    const user = userEvent.setup()
    renderApp('/agents')
    await user.click(await screen.findByRole('button', { name: 'Register agent' }))
    await user.click(screen.getByRole('button', { name: /Runtime agent/ }))
    await user.type(screen.getByLabelText('Name'), 'focus-bot')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByRole('heading', { name: 'focus-bot registered' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Register agent' })).toHaveFocus()
  })

  it('returns focus to New group after Cancel', async () => {
    const user = userEvent.setup()
    renderApp('/agents')
    await user.click(await screen.findByRole('button', { name: 'New group' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'New group' })).toHaveFocus()
  })
})

describe('Register agent into another group', () => {
  it('switches the filter to the new agent group so the row is visible', async () => {
    const user = userEvent.setup()
    renderApp('/agents?group=customer-service')
    await user.click(await screen.findByRole('button', { name: 'Register agent' }))
    await user.type(screen.getByLabelText('Name'), 'Billing Bot')
    await user.type(screen.getByLabelText('Upstream URL'), 'https://billing.acme.internal/chat')
    await user.selectOptions(screen.getByLabelText('Group'), 'Legal')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    const row = (await screen.findByRole('link', { name: 'Billing Bot' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Legal')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/agents?group=legal'))
  })
})
