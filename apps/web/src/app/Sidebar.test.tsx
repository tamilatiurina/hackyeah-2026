import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthProvider'
import { createFakeAuth, DEMO_EMAIL } from '../test/fakeAuth'
import { describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar'

function renderSidebar(counts?: Partial<Record<string, number>>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/sessions']}>
        <AuthProvider client={createFakeAuth()} initialSession={createFakeAuth().session}>
          <Sidebar id="sb" open={false} onNavigate={() => {}} counts={counts} />
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

  it('shows the signed-in account and no role switch', () => {
    renderSidebar()
    expect(screen.getByText(DEMO_EMAIL)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByText('Viewing as')).not.toBeInTheDocument()
  })
})
