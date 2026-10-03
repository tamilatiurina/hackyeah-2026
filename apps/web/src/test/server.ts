import { setupServer } from 'msw/node'
import { handlers } from '../mocks/handlers'
import { fakeApiHandlers } from './fakeApi'

// Mock-only endpoints (agents) plus a stand-in for the real API's guardrail endpoints.
export const server = setupServer(...handlers, ...fakeApiHandlers)
