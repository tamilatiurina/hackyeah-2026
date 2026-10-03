import { describe, expect, it } from 'vitest'
import { isHttpUrl, validateAgentForm, type AgentForm } from './validation'

const valid: AgentForm = {
  name: 'Billing Bot',
  description: '',
  upstreamUrl: 'https://billing.example/chat',
  sendAuthHeader: false,
  authHeaderName: 'Authorization',
  authHeaderValue: '',
}

describe('validateAgentForm', () => {
  it('accepts a valid form', () => {
    expect(validateAgentForm(valid)).toEqual({})
  })

  it('checks name, description and URL limits', () => {
    expect(validateAgentForm({ ...valid, name: '  ' }).name).toBe('Name is required')
    expect(validateAgentForm({ ...valid, name: 'x'.repeat(101) }).name).toBe('Use at most 100 characters')
    expect(validateAgentForm({ ...valid, description: 'x'.repeat(1001) }).description).toBe(
      'Use at most 1,000 characters',
    )
    expect(validateAgentForm({ ...valid, upstreamUrl: '' }).upstreamUrl).toBe('Upstream URL is required')
    expect(validateAgentForm({ ...valid, upstreamUrl: 'ftp://x' }).upstreamUrl).toBe('Enter an http or https URL')
  })

  it('requires header name and value only when sending a header', () => {
    expect(validateAgentForm({ ...valid, authHeaderName: '', authHeaderValue: '' })).toEqual({})
    const errors = validateAgentForm({ ...valid, sendAuthHeader: true, authHeaderName: ' ', authHeaderValue: '' })
    expect(errors).toEqual({ authHeaderName: 'Header name is required', authHeaderValue: 'Header value is required' })
  })
})

describe('isHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(isHttpUrl('https://a.test')).toBe(true)
    expect(isHttpUrl('ws://a.test')).toBe(false)
  })
})
