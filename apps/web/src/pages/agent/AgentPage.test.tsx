import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const overview = () => screen.getByRole('region', { name: 'Overview' })

describe('AgentPage', () => {
  it('shows the agent overview from the API', async () => {
    renderApp('/agents/agent-support')
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })).toBeInTheDocument()
    const o = within(overview())
    expect(o.getByText('Answers order questions.')).toBeInTheDocument()
    expect(o.getByText('https://support-agent.acme.example')).toBeInTheDocument()
    expect(o.getByText('https://support-agent.acme.example/a2a')).toBeInTheDocument()
    expect(o.getByText('v1.0.0 · 1 skill')).toBeInTheDocument()
    expect(o.getByText('Orders and returns')).toBeInTheDocument()
    expect(o.getByText('Authorization')).toBeInTheDocument()
    expect(o.getByText('agent-support')).toBeInTheDocument()
    expect(o.getByText('1')).toBeInTheDocument() // config version
    expect(screen.getByRole('link', { name: '← Agents' })).toHaveAttribute('href', '/agents')
  })

  it('shows dashes and None for an agent without description or auth header', async () => {
    renderApp('/agents/agent-contracts')
    await screen.findByRole('heading', { level: 1, name: 'Contract Summarizer' })
    expect(within(overview()).getByText('—')).toBeInTheDocument()
    expect(within(overview()).getByText('None')).toBeInTheDocument()
  })

  it('asks to re-register an agent that has no Agent Card', async () => {
    renderApp('/agents/agent-contracts')
    await screen.findByRole('heading', { level: 1, name: 'Contract Summarizer' })
    expect(within(overview()).getByText(/registered before A2A/)).toBeInTheDocument()
    expect(within(overview()).queryByText('Skills')).not.toBeInTheDocument()
  })

  it('hides the config version when the API does not send it', async () => {
    fakeApi.agents[0] = { ...fakeApi.agents[0], config_version: undefined }
    renderApp('/agents/agent-support')
    await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
    expect(within(overview()).queryByText('Config version')).not.toBeInTheDocument()
  })

  it('shows not found for an unknown agent', async () => {
    renderApp('/agents/nope')
    expect(await screen.findByRole('heading', { name: 'Agent not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to agents' })).toHaveAttribute('href', '/agents')
  })

  it('treats a malformed id (422) as not found', async () => {
    server.use(
      http.get(apiPath('/agents/:id'), () =>
        HttpResponse.json({ detail: [{ type: 'uuid_parsing', loc: ['path', 'agent_id'], msg: 'bad', input: 'x' }] }, { status: 422 }),
      ),
    )
    renderApp('/agents/x')
    expect(await screen.findByRole('heading', { name: 'Agent not found' })).toBeInTheDocument()
  })

  it('shows an error with a working Retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(apiPath('/agents/:id'), () => HttpResponse.json({ detail: 'Could not read agents' }, { status: 503 }), {
        once: true,
      }),
    )
    renderApp('/agents/agent-support')
    expect(await screen.findByText("Couldn't load this agent.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })).toBeInTheDocument()
  })

  it('is reached from the agents table', async () => {
    const user = userEvent.setup()
    renderApp('/agents')
    await user.click(await screen.findByRole('link', { name: 'Support Assistant' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })).toBeInTheDocument()
  })
})
