import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AgentsPage } from '../pages/agents/AgentsPage'
import { GuardrailsPage } from '../pages/guardrails/GuardrailsPage'
import { Placeholder } from '../pages/Placeholder'
import { Layout } from './Layout'
import { homeFor, navItemsFor } from './nav'
import { useRole } from './role'

// Screens that exist; every other nav item renders its placeholder.
const PAGES: Partial<Record<string, ReactElement>> = {
  '/agents': <AgentsPage />,
  '/guardrails': <GuardrailsPage />,
}

export function AppRoutes() {
  const { role } = useRole()

  return (
    <Routes>
      <Route element={<Layout />}>
        {navItemsFor(role).map((item) => (
          <Route
            key={item.path}
            path={item.path}
            element={PAGES[item.path] ?? <Placeholder title={item.title} issue={item.issue} />}
          />
        ))}
        {role !== 'tester' && (
          <Route path="/agents/:agentId" element={<Placeholder title="Agent" issue="D-03 / D-04" />} />
        )}
        <Route path="*" element={<Navigate to={homeFor(role)} replace />} />
      </Route>
    </Routes>
  )
}
