import { screen, within } from '@testing-library/react'
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

  it.each(['/sign-in', '/sign-up'])('%s sends signed-in users to the app', (path) => {
    renderApp(path)
    expect(location()).toBe('/agents')
  })

  it('lists every nav item, grouped under Library and Monitor', () => {
    renderApp('/agents')
    const labels = within(mainNav())
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels).toEqual(NAV_ITEMS.map((i) => i.label))
    expect(within(mainNav()).getByText('Library')).toBeInTheDocument()
    expect(within(mainNav()).getByText('Monitor')).toBeInTheDocument()
  })

  it('has no context switch', () => {
    renderApp('/agents')
    expect(screen.queryByRole('group', { name: 'View context' })).not.toBeInTheDocument()
  })

  it('redirects / to /agents', () => {
    renderApp('/')
    expect(location()).toBe('/agents')
  })

  it.each(['/nope', '/playground', '/policies', '/incidents', '/pi-sessions'])(
    'redirects %s to /agents',
    (path) => {
      renderApp(path)
      expect(location()).toBe('/agents')
    },
  )

  it('keeps Agents active on an agent page', async () => {
    renderApp('/agents/support-bot')
    expect(await screen.findByRole('heading', { level: 1, name: 'Agent not found' })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: 'Agents' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
