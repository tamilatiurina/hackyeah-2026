import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthProvider'
import { createFakeAuth } from '../test/fakeAuth'
import { describe, expect, it } from 'vitest'
import { ModeProvider } from './ModeProvider'
import { RoleProvider } from './RoleProvider'
import { Sidebar } from './Sidebar'

function renderSidebar(counts?: Partial<Record<string, number>>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/sessions']}>
        <AuthProvider client={createFakeAuth()} initialSession={createFakeAuth().session}>
          <RoleProvider>
            <ModeProvider>
              <Sidebar id="sb" open={false} onNavigate={() => {}} counts={counts} />
            </ModeProvider>
          </RoleProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Sidebar', () => {
  it('shows a count badge on a nav item when its count is positive', () => {
    renderSidebar({ '/audit': 3 })
    const audit = screen.getByRole('link', { name: /Audit log/ })
    expect(within(audit).getByText('3')).toBeInTheDocument()
  })

  it('shows no badge when the count is zero', () => {
    renderSidebar({ '/audit': 0 })
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument()
  })

  it('shows the note for the current role', () => {
    renderSidebar()
    expect(
      screen.getByText('Sets mandatory guardrails and caps, and grants exemptions.'),
    ).toBeInTheDocument()
  })
})
