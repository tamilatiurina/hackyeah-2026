import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement

describe('AgentsPage', () => {
  it('lists each agent with its setup status, guardrails and next step', async () => {
    renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    const support = within(rowOf('Support Assistant'))
    expect(support.getByText('https://support-agent.acme.example')).toBeInTheDocument()
    await waitFor(() => expect(support.getByText('1 attached · 1 mandatory')).toBeInTheDocument())
    expect(support.getByText('Setup · 2 of 5')).toBeInTheDocument()
    expect(support.getByText('Not deployed')).toBeInTheDocument()
    expect(support.getByRole('link', { name: 'Choose MCP tools for Support Assistant' })).toHaveAttribute(
      'href',
      '/agents/agent-support/mcp',
    )
    const contracts = within(rowOf('Contract Summarizer'))
    expect(contracts.getByText('Setup · 1 of 5')).toBeInTheDocument()
    expect(contracts.getByRole('link', { name: 'Attach guardrails for Contract Summarizer' })).toHaveAttribute(
      'href',
      '/agents/agent-contracts/guardrails',
    )
    expect(rowOf('Support Assistant').querySelector('a')).toHaveAttribute('href', '/agents/agent-support')
  })

  it('shows traffic and an Open button for a live agent', async () => {
    fakeApi.agents[0] = { ...fakeApi.agents[0], has_gateway_key: true }
    renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    const support = within(rowOf('Support Assistant'))
    expect(support.getByText('Live')).toBeInTheDocument()
    expect(await support.findByText('2 sessions · 4 events')).toBeInTheDocument()
    expect(support.getByRole('link', { name: 'Open Support Assistant' })).toHaveAttribute('href', '/agents/agent-support')
  })

  it('links Register agent to the register page', async () => {
    renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    expect(screen.getByRole('link', { name: 'Register agent' })).toHaveAttribute('href', '/agents/new')
  })

  it('shows the empty state with the setup steps', async () => {
    server.use(http.get(apiPath('/agents'), () => HttpResponse.json({ data: [], total: 0 })))
    renderApp('/agents')
    expect(await screen.findByText('No agents yet. Register your first one.')).toBeInTheDocument()
    expect(screen.getByText('Go live with a key')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Register agent' })).toHaveAttribute('href', '/agents/new')
  })

  it('shows an error with a working Retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(apiPath('/agents'), () => HttpResponse.json({ detail: 'Could not read agents' }, { status: 503 }), {
        once: true,
      }),
    )
    renderApp('/agents')
    expect(await screen.findByText("Couldn't load agents.")).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Register agent' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Support Assistant' })).toBeInTheDocument()
  })
})
