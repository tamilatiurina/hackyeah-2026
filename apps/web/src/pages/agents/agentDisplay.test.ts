import { describe, expect, it } from 'vitest'
import { fakeAgentCard } from '../../test/fakeApi'
import { cardSummary } from './agentDisplay'

describe('cardSummary', () => {
  it('summarises the Agent Card version and skills', () => {
    const card = fakeAgentCard('Support', 'https://support.example')
    expect(cardSummary(card)).toBe('v1.0.0 · 1 skill')
    expect(cardSummary({ ...card, version: '2.1', skills: [...card.skills, ...card.skills] })).toBe('v2.1 · 2 skills')
  })

  it('flags an agent registered before A2A', () => {
    expect(cardSummary(null)).toBe('No Agent Card')
  })
})
