import { describe, expect, it } from 'vitest'
import { formatLabel } from './agentDisplay'

describe('formatLabel', () => {
  it('names the message formats', () => {
    expect(formatLabel('json')).toBe('JSON')
    expect(formatLabel('text')).toBe('Text')
  })
})
