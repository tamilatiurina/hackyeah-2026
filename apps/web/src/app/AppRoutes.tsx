import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { RequireAuth } from '../auth/RequireAuth'
import { AgentPage } from '../pages/agent/AgentPage'
import { AgentsPage } from '../pages/agents/AgentsPage'
import { RegisterAgentPage } from '../pages/agents/RegisterAgentPage'
import { AuditLogPage } from '../pages/audit/AuditLogPage'
import { GuardrailsPage } from '../pages/guardrails/GuardrailsPage'
import { McpServersPage } from '../pages/mcp/McpServersPage'
import { SecurityPage } from '../pages/security/SecurityPage'
import { SessionsPage } from '../pages/sessions/SessionsPage'
import { AuthCallbackPage } from '../pages/auth/AuthCallbackPage'
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '../pages/auth/ResetPasswordPage'
import { SignInPage } from '../pages/auth/SignInPage'
import { SignUpPage } from '../pages/auth/SignUpPage'
import { TestChatPage } from '../pages/test/TestChatPage'
import { Layout } from './Layout'
import { DEFAULT_HOME, NAV_ITEMS } from './nav'

// Every navigation item maps to a shipped screen.
const PAGES: Record<string, ReactElement> = {
  '/agents': <AgentsPage />,
  '/audit': <AuditLogPage />,
  '/guardrails': <GuardrailsPage />,
  '/mcp': <McpServersPage />,
  '/sessions': <SessionsPage />,
  '/test': <TestChatPage />,
  '/security': <SecurityPage />,
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        {NAV_ITEMS.map((item) => (
          <Route key={item.path} path={item.path} element={PAGES[item.path]} />
        ))}
        <Route path="/agents/new" element={<RegisterAgentPage />} />
        {/* Not in the nav (agents are tested from their workspace), but deep links keep working. */}
        <Route path="/test" element={<TestChatPage />} />
        <Route path="/agents/:agentId/:section?" element={<AgentPage />} />
        <Route path="*" element={<Navigate to={DEFAULT_HOME} replace />} />
      </Route>
    </Routes>
  )
}
