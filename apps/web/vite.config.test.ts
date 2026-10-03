import type { UserConfig } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import viteConfig from './vite.config'

type ConfigFn = (env: { mode: string; command: 'build' | 'serve' }) => UserConfig

afterEach(() => vi.unstubAllEnvs())

describe('vite.config Supabase settings', () => {
  it('exposes exactly SUPABASE_URL and SUPABASE_KEY to the browser bundle', () => {
    vi.stubEnv('SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('SUPABASE_KEY', 'sb_publishable_test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'must-not-leak')
    const config = (viteConfig as unknown as ConfigFn)({ mode: 'production', command: 'build' })
    expect(config.define).toEqual({
      'import.meta.env.SUPABASE_URL': JSON.stringify('https://abc.supabase.co'),
      'import.meta.env.SUPABASE_KEY': JSON.stringify('sb_publishable_test'),
    })
    expect(JSON.stringify(config)).not.toContain('must-not-leak')
    expect(config.envPrefix ?? 'VITE_').toBe('VITE_')
  })

  it('defines empty strings when they are not set', () => {
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_KEY', '')
    const config = (viteConfig as unknown as ConfigFn)({ mode: 'production', command: 'build' })
    expect(config.define).toEqual({
      'import.meta.env.SUPABASE_URL': '""',
      'import.meta.env.SUPABASE_KEY': '""',
    })
  })
})
