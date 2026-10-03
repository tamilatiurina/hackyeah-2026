import { describe, expect, it } from 'vitest'
import vercelJson from '../vercel.json?raw'

interface Rewrite {
  source: string
  destination: string
}

const config = JSON.parse(vercelJson) as {
  rewrites: Rewrite[]
}

describe('vercel.json', () => {
  it('sends /api/* to the FastAPI deployment before the SPA fallback', () => {
    const sources = config.rewrites.map((r) => r.source)
    expect(sources.indexOf('/api/(.*)')).toBeGreaterThanOrEqual(0)
    expect(sources.indexOf('/api/(.*)')).toBeLessThan(sources.indexOf('/(.*)'))
    expect(config.rewrites.find((r) => r.source === '/api/(.*)')?.destination).toBe(
      'https://hackyeah-2026-8v1w.vercel.app/api/$1',
    )
  })
})
