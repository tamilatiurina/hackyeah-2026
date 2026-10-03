import { setupServer } from 'msw/node'
import { fakeApiHandlers } from './fakeApi'
import { fakePiPolicyHandlers } from './fakePiPolicy'

// Stand-ins for the real API (apps/api) in tests: the guardrail/signature endpoints plus
// the pi policy + playground endpoints.
export const server = setupServer(...fakeApiHandlers, ...fakePiPolicyHandlers)
