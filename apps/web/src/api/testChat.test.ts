import { afterEach, describe, expect, it, vi } from 'vitest'
import { newContextId } from './testChat'

afterEach(() => vi.unstubAllGlobals())

describe('newContextId', () => {
  it('works where crypto.randomUUID is missing (plain HTTP on a LAN address)', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
    const a = newContextId()
    const b = newContextId()
    expect(a).toMatch(/^ctx-[0-9a-f-]{20,}$/)
    expect(a).not.toBe(b)
  })
})
