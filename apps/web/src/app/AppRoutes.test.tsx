import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { PANEL_NAV_ITEMS } from './nav'

const mainNav = () => screen.getByRole('navigation', { name: 'Main' })
const location = () => screen.getByTestId('location').textContent

describe('AppRoutes', () => {
  it.each(PANEL_NAV_ITEMS.map((item) => [item.path, item.title] as const))(
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
    expect(labels).toEqual(PANEL_NAV_ITEMS.map((i) => i.label))
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
    renderApp('/agents')
    await user.click(screen.getByRole('button', { name: 'Developer' }))
    expect(location()).toBe('/agents')
    expect(screen.getByRole('button', { name: 'Developer' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('agent mode shows only the pi pages and hides panel pages', () => {
    renderApp('/policies', 'admin', { mode: 'agent' })
    expect(screen.getByRole('heading', { level: 1, name: 'Policies' })).toBeInTheDocument()
    const labels = within(mainNav())
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels).toEqual(['Playground', 'Policies', 'Incidents', 'Sessions'])
  })

  it('agent mode redirects panel deep links to the playground', () => {
    renderApp('/agents', 'admin', { mode: 'agent' })
    expect(location()).toBe('/playground')
    expect(screen.getByRole('heading', { level: 1, name: 'Playground' })).toBeInTheDocument()
  })

  it('panel mode redirects /policies to the panel home (it lives in agent mode)', () => {
    renderApp('/policies', 'admin', { mode: 'panel' })
    expect(location()).toBe('/sessions')
  })

  it('switching to Agent Integrated goes to the playground and back to Agent Wrapped goes to Sessions', async () => {
    const user = userEvent.setup()
    renderApp('/fleet')
    await user.click(screen.getByRole('button', { name: 'Agent Integrated' }))
    expect(location()).toBe('/playground')
    await user.click(screen.getByRole('button', { name: 'Agent Wrapped' }))
    expect(location()).toBe('/sessions')
  })
})
