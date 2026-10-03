import type { AgentCard } from '../../api/types'

/** One-line summary of an agent's A2A Agent Card, e.g. "v1.2.0 · 3 skills". */
export function cardSummary(card: AgentCard | null): string {
  if (!card) return 'No Agent Card'
  const skills = card.skills.length
  return `v${card.version} · ${skills} ${skills === 1 ? 'skill' : 'skills'}`
}
