import { postJson } from './client'

/** What POST /me/bootstrap did; each step runs once per account (apps/api/app/api/routes/me.py). */
export interface Bootstrap {
  library: 'seeded' | 'already_seeded'
  demo_agent: 'added' | 'already_added' | 'unavailable'
}

/** First-sign-in setup: the seed guardrails and signatures, and the shared demo agent. */
export function bootstrapAccount(): Promise<Bootstrap> {
  return postJson<Bootstrap>('/me/bootstrap', {})
}
