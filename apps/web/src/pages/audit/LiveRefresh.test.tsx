import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const newEvent = {
  id: 'ev-6',
  at: '2026-10-04T10:12:00Z',
  agent_id: 'agent-support',
  agent_name: null,
  context_id: 'ctx-active',
  rule_id: 'g-secret',
  rule_name: 'Secret keys',
  kind: 'guardrail' as const,
  stage: 'output' as const,
  action: 'redact' as const,
  config_version: 'v-3f2a',
  details: 'Matched an AWS key',
}

describe('Live updates (#102)', () => {
  it('shows new audit events as they are recorded, without Refresh', async () => {
    const { auth } = renderApp('/audit')
    await screen.findByRole('region', { name: 'Audit events table' })
    expect(await screen.findByText('Live')).toBeInTheDocument()
    expect(auth.watchedTables()).toContain('audit_events')

    fakeApi.auditEvents = [newEvent, ...fakeApi.auditEvents]
    auth.emitTableChange('audit_events')

    expect(await screen.findByText('Matched an AWS key')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Secret keys' })).toBeInTheDocument() // rule filter too
  })

  it('updates session counters live', async () => {
    const { auth } = renderApp('/sessions')
    await screen.findByRole('region', { name: 'Sessions table' })
    expect(await screen.findByText('Live')).toBeInTheDocument()
    expect(auth.watchedTables()).toEqual(expect.arrayContaining(['agent_sessions', 'audit_events']))

    fakeApi.sessions = fakeApi.sessions.map((s) => (s.context_id === 'ctx-active' ? { ...s, turns: 4, events: 3 } : s))
    auth.emitTableChange('agent_sessions')

    const row = screen.getByRole('row', { name: /ctx-active/ })
    await waitFor(() => expect(within(row).getByRole('link', { name: '3 events' })).toBeInTheDocument())
  })

  it('stops listening when the page closes', async () => {
    const { auth, unmount } = renderApp('/audit')
    await screen.findByText('Live')
    unmount()
    expect(auth.watchedTables()).toEqual([])
  })

  it('works as before without realtime', async () => {
    renderApp('/audit', { realtime: false })
    await screen.findByRole('region', { name: 'Audit events table' })
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })
})
