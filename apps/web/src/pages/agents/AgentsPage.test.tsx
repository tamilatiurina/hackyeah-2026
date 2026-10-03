import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'
import { apiPath } from '../../api/client'

const table = () => screen.getByRole('table')
const agentNames = () =>
  within(table())
    .getAllByRole('link')
    .map((a) => a.textContent)
const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement
const location = () => screen.getByTestId('location').textContent

describe('AgentsPage', () => {
  it('lists all seed agents with their status and endpoint', async () => {
    renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    expect(agentNames()).toEqual([
      'dev-agent',
      'demo-agent',
      'readonly-agent',
      'Support Assistant',
      'Returns Bot',
      'Contract Summarizer',
      'HR Policy Q&A',
    ])
    expect(within(rowOf('Support Assistant')).getByText('Deployed · v4')).toBeInTheDocument()
    expect(within(rowOf('Support Assistant')).getByText('https://support-agent.acme.internal/api/chat')).toBeInTheDocument()
    expect(within(rowOf('Support Assistant')).getByText('Customer Service')).toBeInTheDocument()
    expect(within(rowOf('Returns Bot')).getByText('Draft')).toBeInTheDocument()
    expect(within(rowOf('dev-agent')).getByText('Online')).toBeInTheDocument()
    expect(within(rowOf('dev-agent')).getByText('WebSocket · connected')).toBeInTheDocument()
    expect(within(rowOf('readonly-agent')).getByText('Offline')).toBeInTheDocument()
    expect(within(rowOf('readonly-agent')).getByText('WebSocket · last seen 12 min ago')).toBeInTheDocument()
    expect(rowOf('dev-agent').querySelector('a')).toHaveAttribute('href', '/agents/dev-agent')
  })

  it('filters by group and keeps the choice in the URL', async () => {
    const user = userEvent.setup()
    renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    await user.click(screen.getByRole('button', { name: 'Legal' }))
    expect(agentNames()).toEqual(['Contract Summarizer'])
    expect(location()).toBe('/agents?group=legal')
    expect(screen.getByRole('button', { name: 'Legal' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(agentNames()).toHaveLength(7)
    expect(location()).toBe('/agents')
  })

  it('opens filtered from a link', async () => {
    renderApp('/agents?group=legal')
    await screen.findByRole('link', { name: 'Contract Summarizer' })
    expect(agentNames()).toEqual(['Contract Summarizer'])
  })

  it('treats an unknown group in the URL as All', async () => {
    renderApp('/agents?group=nope')
    await screen.findByRole('link', { name: 'Support Assistant' })
    expect(agentNames()).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows an empty message for a group without agents', async () => {
    server.use(
      http.get(apiPath('/groups'), () => HttpResponse.json([{ id: 'finance', name: 'Finance' }])),
    )
    renderApp('/agents?group=finance')
    expect(await screen.findByText('No agents in this group yet')).toBeInTheDocument()
  })

  it('shows an error with a working Retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(apiPath('/agents'), () => HttpResponse.json({ message: 'boom' }, { status: 500 }), { once: true }),
    )
    renderApp('/agents')
    expect(await screen.findByText("Couldn't load agents.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Support Assistant' })).toBeInTheDocument()
  })
})
