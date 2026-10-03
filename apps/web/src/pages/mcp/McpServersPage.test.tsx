import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function open() {
  const user = userEvent.setup()
  renderApp('/mcp')
  await screen.findByRole('region', { name: 'MCP servers table' })
  return user
}

async function startRegistering() {
  const user = await open()
  await user.click(screen.getByRole('button', { name: 'Register MCP server' }))
  return user
}

describe('MCP servers', () => {
  it('lists servers with their auth and allowed tools, never the secret', async () => {
    await open()
    const row = screen.getByRole('row', { name: /Orders/ })
    expect(within(row).getByText('https://mcp.acme.example/orders')).toBeInTheDocument()
    expect(within(row).getByText('API key (X-Api-Key)')).toBeInTheDocument()
    expect(within(row).getByRole('list', { name: 'Tools of Orders' })).toHaveTextContent('get_orderlist_orders')
  })

  it('registers a server with an API key', async () => {
    const user = await startRegistering()
    await user.type(screen.getByLabelText('Name'), 'Docs')
    await user.type(screen.getByLabelText('URL'), 'https://mcp.acme.example/docs')
    await user.selectOptions(screen.getByLabelText('Auth'), 'api_key')
    await user.type(screen.getByLabelText('API key'), 'sk-docs')
    await user.type(screen.getByLabelText('Allowed tools'), 'search_docs,\nget_page')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(await screen.findByRole('row', { name: /Docs/ })).toBeInTheDocument()
    expect(fakeApi.lastMcpServerCreate).toEqual({
      name: 'Docs',
      url: 'https://mcp.acme.example/docs',
      auth: { type: 'api_key', header: 'Authorization', api_key: 'sk-docs' },
      allowed_tools: ['search_docs', 'get_page'],
    })
    expect(screen.getByRole('button', { name: 'Register MCP server' })).toHaveFocus()
  })

  it('sends OAuth client credentials with scopes', async () => {
    const user = await startRegistering()
    await user.type(screen.getByLabelText('Name'), 'CRM')
    await user.type(screen.getByLabelText('URL'), 'https://mcp.acme.example/crm')
    await user.selectOptions(screen.getByLabelText('Auth'), 'oauth')
    await user.type(screen.getByLabelText('Token URL'), 'https://auth.acme.example/token')
    await user.type(screen.getByLabelText('Client ID'), 'hub')
    await user.type(screen.getByLabelText('Client secret'), 's3cret')
    await user.type(screen.getByLabelText('Scopes'), 'crm.read crm.write')
    await user.type(screen.getByLabelText('Allowed tools'), 'find_customer')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(await screen.findByText('OAuth (hub)')).toBeInTheDocument()
    expect(fakeApi.lastMcpServerCreate?.auth).toEqual({
      type: 'oauth',
      token_url: 'https://auth.acme.example/token',
      client_id: 'hub',
      client_secret: 's3cret',
      scopes: ['crm.read', 'crm.write'],
    })
  })

  it('checks tool names before sending', async () => {
    const user = await startRegistering()
    await user.type(screen.getByLabelText('Name'), 'Docs')
    await user.type(screen.getByLabelText('URL'), 'https://mcp.acme.example/docs')
    await user.type(screen.getByLabelText('Allowed tools'), 'search docs!, search')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(screen.getByLabelText('Allowed tools')).toHaveAccessibleDescription(/Invalid tool names: docs!/)
    expect(fakeApi.lastMcpServerCreate).toBeNull()
  })

  it('shows a duplicate name on the Name field', async () => {
    const user = await startRegistering()
    await user.type(screen.getByLabelText('Name'), 'Orders')
    await user.type(screen.getByLabelText('URL'), 'https://mcp.acme.example/other')
    await user.type(screen.getByLabelText('Allowed tools'), 'get_order')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(await screen.findByText("MCP server 'Orders' already exists")).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('deletes a server after confirmation', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Delete Orders' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete Orders' }))
    expect(await screen.findByText('No MCP servers registered yet.')).toBeInTheDocument()
    expect(fakeApi.mcpServers).toEqual([])
  })
})
