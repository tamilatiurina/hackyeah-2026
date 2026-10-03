/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Empty prefix loads unprefixed vars too (and the host's environment, e.g. on Vercel).
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy: { '/api': env.API_URL || 'http://localhost:8000' } },
    // Ship exactly these two to the browser, under the same names the API uses. SUPABASE_KEY must be
    // the publishable/anon key. (A SUPABASE_ envPrefix would also ship e.g. the service-role key.)
    define: {
      'import.meta.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL ?? ''),
      'import.meta.env.SUPABASE_KEY': JSON.stringify(env.SUPABASE_KEY ?? ''),
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
