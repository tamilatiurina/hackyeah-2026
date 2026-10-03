import { setupServer } from 'msw/node'
import { fakeApiHandlers } from './fakeApi'

// Stand-in for the real API (apps/api) in tests.
export const server = setupServer(...fakeApiHandlers)
