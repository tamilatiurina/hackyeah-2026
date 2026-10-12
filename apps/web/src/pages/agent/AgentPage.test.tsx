import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const connection = () => screen.getByRole('region', { name: 'Connection' })
const sectionNav = () => within(screen.getByRole('navigation', { name: 'Agent sections' }))
const location = () => screen.getByTestId('location').textContent

describe('AgentPage', () => {
  it('opens on the setup checklist with the next step highlighted', async () => {
    renderApp('/agents/agent-support')
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })).toBeInTheDocument()
    expect(await screen.findByText('Setup · 2 of 5', { selector: 'span' })).toBeInTheDocument()
    const checklist = within(screen.getByRole('region', { name: 'Get Support Assistant ready for callers' }))
    await waitFor(() => expect(checklist.getByText('2 of 5 done')).toBeInTheDocument())
    expect(checklist.getByRole('link', { name: 'Choose MCP tools' })).toHaveAttribute('href', '/agents/agent-support/mcp')
    expect(checklist.getByText('1 guardrail attached, running after 1 mandatory')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '/agents')
  })

  it('shows the setup steps in a side nav and marks the current section', async () => {
    renderApp('/agents/agent-support/guardrails')
    await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
    expect(sectionNav().getByRole('link', { name: /Guardrails/ })).toHaveAttribute('aria-current', 'page')
    expect(sectionNav().getByRole('link', { name: /MCP tools/ })).toHaveAttribute('href', '/agents/agent-support/mcp')
    expect(sectionNav().getByRole('link', { name: /Go live/ })).toBeInTheDocument()
    expect(sectionNav().getByRole('link', { name: 'Activity' })).toBeInTheDocument()
  })

  it('advances to the next step from the overview footer', async () => {
    const user = userEvent.setup()
    renderApp('/agents/agent-support')
    await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
    const bar = within(await screen.findByRole('region', { name: 'Next step' }))
    await waitFor(() => expect(bar.getByText('Next: MCP tools.')).toBeInTheDocument())
    await user.click(bar.getByRole('button', { name: 'Choose MCP tools' }))
    expect(location()).toBe('/agents/agent-support/mcp')
  })

  it('offers the next step in the header when another section is open', async () => {
    renderApp('/agents/agent-support/activity')
    await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Next: Choose MCP tools' })).toHaveAttribute('href', '/agents/agent-support/mcp'),
    )
  })

  it('shows the guarded URL and recent activity once live', async () => {
    fakeApi.agents[0] = { ...fakeApi.agents[0], has_gateway_key: true }
    renderApp('/agents/agent-support')
    await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
    expect(screen.getByText('Live', { selector: 'span' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Guarded URL' })).getByText(`${window.location.origin}/a/agent-support`)).toBeInTheDocument()
    const activity = within(screen.getByRole('region', { name: 'Recent activity' }))
    expect(await activity.findByText('Email address')).toBeInTheDocument()
    expect(activity.queryByText('Card number')).not.toBeInTheDocument() // only the latest three
    expect(screen.queryByRole('region', { name: 'Next step' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy guarded URL' })).toBeInTheDocument()
  })

  it('redirects an unknown section to the overview', async () => {
    renderApp('/agents/agent-support/nope')
    await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
    expect(location()).toBe('/agents/agent-support')
  })

  it('shows the connection details from the API', async () => {
    renderApp('/agents/agent-support/connection')
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })).toBeInTheDocument()
    const o = within(connection())
    expect(o.getByText('Answers order questions.')).toBeInTheDocument()
    expect(o.getByText('https://support-agent.acme.example')).toBeInTheDocument()
    expect(o.getByText('https://support-agent.acme.example/a2a')).toBeInTheDocument()
    expect(o.getByText('v1.0.0 · 1 skill')).toBeInTheDocument()
    expect(o.getByText('Orders and returns')).toBeInTheDocument()
    expect(o.getByText('Authorization')).toBeInTheDocument()
    expect(o.getByText('agent-support')).toBeInTheDocument()
    expect(o.getByText('1')).toBeInTheDocument() // config version
  })

  it('shows dashes and None for an agent without description or auth header', async () => {
    renderApp('/agents/agent-contracts/connection')
    await screen.findByRole('heading', { level: 1, name: 'Contract Summarizer' })
    expect(within(connection()).getByText('—')).toBeInTheDocument()
    expect(within(connection()).getByText('None')).toBeInTheDocument()
  })

  it('asks to re-register an agent that has no Agent Card', async () => {
    renderApp('/agents/agent-contracts/connection')
    await screen.findByRole('heading', { level: 1, name: 'Contract Summarizer' })
    expect(within(connection()).getByText(/registered before A2A/)).toBeInTheDocument()
    expect(within(connection()).queryByText('Skills')).not.toBeInTheDocument()
  })

  it('hides the config version when the API does not send it', async () => {
    fakeApi.agents[0] = { ...fakeApi.agents[0], config_version: undefined }
    renderApp('/agents/agent-support/connection')
    await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
    expect(within(connection()).queryByText('Config version')).not.toBeInTheDocument()
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
