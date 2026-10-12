import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function open() {
  const user = userEvent.setup()
  renderApp('/agents/agent-support/mcp')
  const section = within(await screen.findByRole('region', { name: /^MCP tools/ }))
  const registered = within(screen.getByRole('region', { name: 'Registered servers' }))
  return { user, section, registered }
}

const access = () => fakeApi.mcpAccess.filter((a) => a.agent_id === 'agent-support')
const toast = () => screen.getAllByRole('status').find((el) => el.textContent)

describe('Agent MCP tools step (FR-17)', () => {
  it('adds a registered server with all of its tools and completes the step', async () => {
    const { user, section, registered } = await open()
    expect(await section.findByText(/This agent has no MCP servers yet\./)).toBeInTheDocument()
    await user.click(await registered.findByRole('button', { name: 'Add Orders' }))

    const orders = within(await section.findByRole('group', { name: /Orders/ }))
    expect(orders.getByRole('checkbox', { name: 'get_order' })).toBeChecked()
    expect(orders.getByRole('checkbox', { name: 'list_orders' })).toBeChecked()
    expect(access()).toEqual([
      { agent_id: 'agent-support', server_id: 'mcp-orders', allowed_tools: ['get_order', 'list_orders'] },
    ])
    expect(await registered.findByText('Every registered server is already granted to this agent.')).toBeInTheDocument()
    await waitFor(() => expect(fakeApi.setupSteps).toEqual([{ agentId: 'agent-support', step: 'mcp' }]))
  })

  it('narrows the tools an agent may call', async () => {
    fakeApi.mcpAccess = [{ agent_id: 'agent-support', server_id: 'mcp-orders', allowed_tools: ['get_order', 'list_orders'] }]
    const { user, section } = await open()
    const orders = within(await section.findByRole('group', { name: /Orders/ }))
    expect(orders.getByText('2 of 2 tools allowed')).toBeInTheDocument()
    expect(orders.queryByRole('button', { name: 'Save tools for Orders' })).not.toBeInTheDocument()
    await user.click(orders.getByRole('checkbox', { name: 'list_orders' }))
    expect(orders.getByText('1 of 2 tools allowed · unsaved')).toBeInTheDocument()
    await user.click(orders.getByRole('button', { name: 'Save tools for Orders' }))

    await waitFor(() => expect(access()[0]?.allowed_tools).toEqual(['get_order']))
    await waitFor(() => expect(toast()).toHaveTextContent('Saved the tools for Orders.'))
  })

  it('undoes an unsaved selection', async () => {
    fakeApi.mcpAccess = [{ agent_id: 'agent-support', server_id: 'mcp-orders', allowed_tools: ['get_order', 'list_orders'] }]
    const { user, section } = await open()
    const orders = within(await section.findByRole('group', { name: /Orders/ }))
    await user.click(orders.getByRole('checkbox', { name: 'list_orders' }))
    await user.click(orders.getByRole('button', { name: 'Undo' }))
    expect(orders.getByRole('checkbox', { name: 'list_orders' })).toBeChecked()
    expect(orders.queryByRole('button', { name: 'Save tools for Orders' })).not.toBeInTheDocument()
  })

  it('needs at least one tool', async () => {
    fakeApi.mcpAccess = [{ agent_id: 'agent-support', server_id: 'mcp-orders', allowed_tools: ['get_order'] }]
    const { user, section } = await open()
    const orders = within(await section.findByRole('group', { name: /Orders/ }))
    await user.click(orders.getByRole('checkbox', { name: 'get_order' }))
    expect(orders.getByRole('button', { name: 'Save tools for Orders' })).toBeDisabled()
    expect(orders.getByText('Keep at least one tool, or remove the server.')).toBeInTheDocument()
  })

  it('removes a server from the agent', async () => {
    fakeApi.mcpAccess = [{ agent_id: 'agent-support', server_id: 'mcp-orders', allowed_tools: ['get_order'] }]
    const { user, section } = await open()
    await user.click(await section.findByRole('button', { name: 'Remove Orders' }))
    expect(await section.findByText(/This agent has no MCP servers yet\./)).toBeInTheDocument()
    expect(access()).toEqual([])
  })

  it('points to the registry when no server is registered', async () => {
    fakeApi.mcpServers = []
    const { registered } = await open()
    expect(await registered.findByText('No MCP servers are registered yet.')).toBeInTheDocument()
    expect(registered.getByRole('link', { name: 'Register a server' })).toHaveAttribute('href', '/mcp')
  })

  it('can be skipped from the next-step bar', async () => {
    const { user } = await open()
    const bar = within(screen.getByRole('region', { name: 'Next step' }))
    await user.click(bar.getByRole('button', { name: 'Skip for now' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/agents/agent-support/test'))
    expect(fakeApi.agents[0].mcp_reviewed).toBe(true)
  })
})
