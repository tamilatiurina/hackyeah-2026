import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { RequireAuth } from '../auth/RequireAuth'
import { AgentPage } from '../pages/agent/AgentPage'
import { AgentsPage } from '../pages/agents/AgentsPage'
import { GuardrailsPage } from '../pages/guardrails/GuardrailsPage'
import { McpServersPage } from '../pages/mcp/McpServersPage'
import { Placeholder } from '../pages/Placeholder'
import { SignInPage } from '../pages/SignInPage'
import { TestChatPage } from '../pages/test/TestChatPage'
import { Layout } from './Layout'
import { homeFor, navItemsFor } from './nav'
import { useRole } from './role'

// Screens that exist; every other nav item renders its placeholder.
const PAGES: Partial<Record<string, ReactElement>> = {
  '/agents': <AgentsPage />,
  '/guardrails': <GuardrailsPage />,
  '/mcp': <McpServersPage />,
  '/test': <TestChatPage />,
}

export function AppRoutes() {
  const { role } = useRole()

  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        {navItemsFor(role).map((item) => (
          <Route
            key={item.path}
            path={item.path}
            element={PAGES[item.path] ?? <Placeholder title={item.title} issue={item.issue} />}
          />
        ))}
        {role !== 'tester' && (
          <Route path="/agents/:agentId" element={<AgentPage />} />
        )}
        <Route path="*" element={<Navigate to={homeFor(role)} replace />} />
      </Route>
    </Routes>
  )
}
