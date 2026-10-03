import { describe, expect, it } from 'vitest'
import type { RegisterAgentInput } from './types'
import { RUNTIME_NAME_HINT, checkReachable, hasErrors, isHttpUrl, validateRegistration } from './validation'

const proxy: RegisterAgentInput = {
  mode: 'proxy',
  name: 'Billing Bot',
  groupId: 'legal',
  owner: 'demo-team',
  upstreamUrl: 'https://billing.acme.internal/chat',
}
const runtime: RegisterAgentInput = { mode: 'runtime', name: 'billing-bot', groupId: 'legal', owner: 'demo-team' }

describe('validateRegistration', () => {
  it('accepts a valid proxy and a valid runtime agent', () => {
    expect(validateRegistration(proxy)).toEqual({})
    expect(validateRegistration(runtime)).toEqual({})
  })

  it('requires name, group and owner', () => {
    const errors = validateRegistration({ ...runtime, name: '  ', groupId: '', owner: ' ' })
    expect(errors).toEqual({
      name: 'Name is required',
      groupId: 'Pick a group',
      owner: 'Owner is required',
    })
  })

  it('allows free-text proxy names but not runtime names with spaces or capitals', () => {
    expect(validateRegistration(proxy).name).toBeUndefined()
    expect(validateRegistration({ ...runtime, name: 'Billing Bot' }).name).toBe(RUNTIME_NAME_HINT)
    expect(validateRegistration({ ...runtime, name: '-billing' }).name).toBe(RUNTIME_NAME_HINT)
  })

  it('requires an http(s) upstream URL for proxy agents only', () => {
    expect(validateRegistration({ ...proxy, upstreamUrl: '' }).upstreamUrl).toBe('Upstream URL is required')
    expect(validateRegistration({ ...proxy, upstreamUrl: 'ftp://x.test' }).upstreamUrl).toBe(
      'Enter an http or https URL',
    )
    expect(validateRegistration({ ...runtime, upstreamUrl: 'nonsense' }).upstreamUrl).toBeUndefined()
  })

  it('trims the URL before checking it', () => {
    expect(validateRegistration({ ...proxy, upstreamUrl: '  https://x.test  ' })).toEqual({})
  })
})

describe('hasErrors', () => {
  it('is false for an empty object and true when any field has a message', () => {
    expect(hasErrors({})).toBe(false)
    expect(hasErrors({ owner: 'Owner is required' })).toBe(true)
  })
})

describe('isHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(isHttpUrl('https://a.test')).toBe(true)
    expect(isHttpUrl('http://a.test/x')).toBe(true)
    expect(isHttpUrl('ws://a.test')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
  })
})

describe('checkReachable', () => {
  it('reports a reachable host with a latency between 80 and 240 ms', () => {
    const result = checkReachable('https://billing.acme.internal/chat')
    expect(result.reachable).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(80)
    expect(result.latencyMs).toBeLessThanOrEqual(240)
  })

  it('gives the same latency for the same host', () => {
    expect(checkReachable('https://a.test/x').latencyMs).toBe(checkReachable('https://a.test/y').latencyMs)
  })

  it('reports hosts containing "unreachable" as not found', () => {
    expect(checkReachable('https://billing.unreachable.test')).toEqual({
      reachable: false,
      error: "Can't reach https://billing.unreachable.test: host not found",
    })
  })

  it('rejects non-http URLs and garbage', () => {
    const expected = { reachable: false, error: 'Only http and https URLs are supported' }
    expect(checkReachable('ftp://files.test')).toEqual(expected)
    expect(checkReachable('nope')).toEqual(expected)
  })
})
