import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function open() {
  const user = userEvent.setup()
  renderApp('/agents/agent-support')
  const section = within(await screen.findByRole('region', { name: 'MCP servers' }))
  return { user, section }
}

const access = () => fakeApi.mcpAccess.filter((a) => a.agent_id === 'agent-support')

describe('Agent MCP servers (FR-17)', () => {
  it('adds a registered server with all of its tools', async () => {
    const { user, section } = await open()
    expect(await section.findByText('This agent has no MCP servers yet.')).toBeInTheDocument()
    await user.selectOptions(section.getByLabelText('Add MCP server'), 'mcp-orders')
    await user.click(section.getByRole('button', { name: 'Add' }))

    const orders = within(await section.findByRole('group', { name: /Orders/ }))
    expect(orders.getByRole('checkbox', { name: 'get_order' })).toBeChecked()
    expect(orders.getByRole('checkbox', { name: 'list_orders' })).toBeChecked()
    expect(access()).toEqual([
      { agent_id: 'agent-support', server_id: 'mcp-orders', allowed_tools: ['get_order', 'list_orders'] },
    ])
    expect(section.queryByRole('option', { name: 'Orders' })).not.toBeInTheDocument() // already added
  })

  it('narrows the tools an agent may call', async () => {
    fakeApi.mcpAccess = [{ agent_id: 'agent-support', server_id: 'mcp-orders', allowed_tools: ['get_order', 'list_orders'] }]
    const { user, section } = await open()
    const orders = within(await section.findByRole('group', { name: /Orders/ }))
    expect(orders.queryByRole('button', { name: 'Save tools for Orders' })).not.toBeInTheDocument()
    await user.click(orders.getByRole('checkbox', { name: 'list_orders' }))
    await user.click(orders.getByRole('button', { name: 'Save tools for Orders' }))

    await waitFor(() => expect(access()[0]?.allowed_tools).toEqual(['get_order']))
    expect(await section.findByText('Saved the tools for Orders.')).toBeInTheDocument()
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
    expect(await section.findByText('This agent has no MCP servers yet.')).toBeInTheDocument()
    expect(access()).toEqual([])
  })

  it('points to the registry when no server is registered', async () => {
    fakeApi.mcpServers = []
    const { section } = await open()
    expect(await section.findByText(/No MCP servers are registered yet/)).toBeInTheDocument()
    expect(section.getByRole('link', { name: 'Register one' })).toHaveAttribute('href', '/mcp')
  })
})
