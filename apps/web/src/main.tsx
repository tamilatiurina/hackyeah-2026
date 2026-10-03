import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { createQueryClient } from './api/queryClient'
import { AppRoutes } from './app/AppRoutes'
import { RoleProvider } from './app/RoleProvider'
import './index.css'

async function enableMocking(): Promise<void> {
  if (import.meta.env.VITE_API_MOCK === 'false') return
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true })
}

const queryClient = createQueryClient()

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <RoleProvider>
            <AppRoutes />
          </RoleProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

enableMocking()
  .catch((error: unknown) => console.error('Mock API failed to start', error))
  .finally(render)
