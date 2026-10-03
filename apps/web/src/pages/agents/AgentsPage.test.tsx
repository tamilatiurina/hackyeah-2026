import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement

describe('AgentsPage', () => {
  it('lists the signed-in user’s agents from the API', async () => {
    renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    const support = within(rowOf('Support Assistant'))
    expect(support.getByText('Answers order questions.')).toBeInTheDocument()
    expect(support.getByText('https://support-agent.acme.example')).toBeInTheDocument()
    expect(support.getByText('v1.0.0 · 1 skill')).toBeInTheDocument()
    expect(support.getByText('Authorization')).toBeInTheDocument()
    const contracts = within(rowOf('Contract Summarizer'))
    expect(contracts.getByText('—')).toBeInTheDocument()
    expect(contracts.getByText('No Agent Card')).toBeInTheDocument()
    expect(contracts.getByText('None')).toBeInTheDocument()
    expect(rowOf('Support Assistant').querySelector('a')).toHaveAttribute('href', '/agents/agent-support')
  })

  it('has no group filter or runtime columns any more', async () => {
    renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    expect(screen.queryByRole('group', { name: 'Filter by group' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Formats' })).not.toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    server.use(http.get(apiPath('/agents'), () => HttpResponse.json({ data: [], total: 0 })))
    renderApp('/agents')
    expect(await screen.findByText('No agents yet. Register your first one.')).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'Register agent' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Support Assistant' })).toBeInTheDocument()
  })
})
