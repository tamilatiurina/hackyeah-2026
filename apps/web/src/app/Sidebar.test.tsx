import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthProvider'
import { createFakeAuth } from '../test/fakeAuth'
import { describe, expect, it } from 'vitest'
import { RoleProvider } from './RoleProvider'
import { Sidebar } from './Sidebar'

function renderSidebar(counts?: Partial<Record<string, number>>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/fleet']}>
        <AuthProvider client={createFakeAuth()} initialSession={createFakeAuth().session}>
          <RoleProvider>
            <Sidebar id="sb" open={false} onNavigate={() => {}} counts={counts} />
          </RoleProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Sidebar', () => {
  it('shows a count badge on a nav item when its count is positive', () => {
    renderSidebar({ '/approvals': 3 })
    const approvals = screen.getByRole('link', { name: /Approvals/ })
    expect(within(approvals).getByText('3')).toBeInTheDocument()
  })

  it('shows no badge when the count is zero', () => {
    renderSidebar({ '/approvals': 0 })
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument()
  })

  it('shows the note for the current role', () => {
    renderSidebar()
    expect(
      screen.getByText('Sets mandatory rules and caps, grants exemptions, and decides any approval.'),
    ).toBeInTheDocument()
  })
})
