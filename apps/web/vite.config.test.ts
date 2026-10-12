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

  it.each(['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'])(
    'falls back to %s synced by the Vercel Supabase integration',
    (name) => {
      vi.stubEnv('SUPABASE_KEY', '')
      vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '')
      vi.stubEnv('SUPABASE_ANON_KEY', '')
      vi.stubEnv(name, 'synced-key')
      const config = (viteConfig as unknown as ConfigFn)({ mode: 'production', command: 'build' })
      expect(config.define?.['import.meta.env.SUPABASE_KEY']).toBe(JSON.stringify('synced-key'))
    },
  )

  it('prefers SUPABASE_KEY, then the publishable key, then the anon key', () => {
    vi.stubEnv('SUPABASE_KEY', 'explicit')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'publishable')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon')
    const build = () => (viteConfig as unknown as ConfigFn)({ mode: 'production', command: 'build' })
    expect(build().define?.['import.meta.env.SUPABASE_KEY']).toBe('"explicit"')
    vi.stubEnv('SUPABASE_KEY', '')
    expect(build().define?.['import.meta.env.SUPABASE_KEY']).toBe('"publishable"')
  })

  it('never ships the service-role key, even when no public key is set', () => {
    vi.stubEnv('SUPABASE_KEY', '')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('SUPABASE_ANON_KEY', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'must-not-leak')
    const config = (viteConfig as unknown as ConfigFn)({ mode: 'production', command: 'build' })
    expect(JSON.stringify(config)).not.toContain('must-not-leak')
  })

  it('defines empty strings when they are not set', () => {
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_KEY', '')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('SUPABASE_ANON_KEY', '')
    const config = (viteConfig as unknown as ConfigFn)({ mode: 'production', command: 'build' })
    expect(config.define).toEqual({
      'import.meta.env.SUPABASE_URL': '""',
      'import.meta.env.SUPABASE_KEY': '""',
    })
  })
})
