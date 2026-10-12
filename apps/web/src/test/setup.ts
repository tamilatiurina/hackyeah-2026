import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { setAccessTokenProvider, setUnauthorizedHandler } from '../api/client'
import { resetFakeApi } from './fakeApi'
import { server } from './server'

// The first render in a file pays for module and MSW warm-up; under a parallel run that can
// exceed the 1 s default for findBy* queries.
configure({ asyncUtilTimeout: 3000 })

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetFakeApi()
  setAccessTokenProvider(() => null)
  setUnauthorizedHandler(null)
  vi.restoreAllMocks()
  localStorage.clear()
})

afterAll(() => server.close())
