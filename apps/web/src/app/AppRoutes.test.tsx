import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { NAV_ITEMS } from './nav'

const mainNav = () => screen.getByRole('navigation', { name: 'Main' })
const location = () => screen.getByTestId('location').textContent

describe('AppRoutes', () => {
  it.each(NAV_ITEMS.map((item) => [item.path, item.title] as const))(
    '%s renders the %s page',
    (path, title) => {
      renderApp(path)
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    },
  )

  it('lists every nav item for admins', () => {
    renderApp('/sessions')
    const labels = within(mainNav())
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels).toEqual(NAV_ITEMS.map((i) => i.label))
  })

  it('redirects / to /sessions', () => {
    renderApp('/')
    expect(location()).toBe('/sessions')
  })

  it('redirects an unknown path to /sessions', () => {
    renderApp('/nope')
    expect(location()).toBe('/sessions')
  })

  it('keeps Agents active on an agent page', async () => {
    renderApp('/agents/support-bot')
    expect(await screen.findByRole('heading', { level: 1, name: 'Agent not found' })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: 'Agents' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('sends a tester to /test and shows only Test chat', () => {
    renderApp('/sessions', 'tester')
    expect(location()).toBe('/test')
    const labels = within(mainNav())
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels).toEqual(['Test chat'])
  })

  it('sends a tester deep link to /test', () => {
    renderApp('/agents/support-bot', 'tester')
    expect(location()).toBe('/test')
  })

  it('switching to Tester goes to /test, and back to Developer goes to /sessions', async () => {
    const user = userEvent.setup()
    renderApp('/policies')
    await user.click(screen.getByRole('button', { name: 'Tester' }))
    expect(location()).toBe('/test')
    await user.click(screen.getByRole('button', { name: 'Developer' }))
    expect(location()).toBe('/sessions')
  })

  it('switching between Admin and Developer keeps the current page', async () => {
    const user = userEvent.setup()
    renderApp('/policies')
    await user.click(screen.getByRole('button', { name: 'Developer' }))
    expect(location()).toBe('/policies')
    expect(screen.getByRole('button', { name: 'Developer' })).toHaveAttribute('aria-pressed', 'true')
  })
})
