import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { createQueryClient } from './api/queryClient'
import { AppRoutes } from './app/AppRoutes'
import { ModeProvider } from './app/ModeProvider'
import { RoleProvider } from './app/RoleProvider'
import { AuthProvider } from './auth/AuthProvider'
import { createAuthClient } from './auth/supabase'
import './index.css'

const queryClient = createQueryClient()
const authClient = createAuthClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider client={authClient} guest>
          <RoleProvider>
            <ModeProvider>
              <AppRoutes />
            </ModeProvider>
          </RoleProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
