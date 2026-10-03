import type { ConnectionResult, RegisterAgentInput } from './types'

export const RUNTIME_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const RUNTIME_NAME_HINT = 'Use lowercase letters, digits and hyphens (this becomes AGENT_NAME)'

const FIELDS = ['name', 'upstreamUrl', 'groupId', 'owner'] as const
export type RegistrationField = (typeof FIELDS)[number]
export type RegistrationErrors = Partial<Record<RegistrationField, string>>

export function isRegistrationField(value: string): value is RegistrationField {
  return (FIELDS as readonly string[]).includes(value)
}

export function hasErrors(errors: RegistrationErrors): boolean {
  return Object.values(errors).some(Boolean)
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function validateRegistration(input: RegisterAgentInput): RegistrationErrors {
  const errors: RegistrationErrors = {}
  const name = input.name.trim()
  if (!name) errors.name = 'Name is required'
  else if (input.mode === 'runtime' && !RUNTIME_NAME_PATTERN.test(name)) errors.name = RUNTIME_NAME_HINT

  if (input.mode === 'proxy') {
    const url = input.upstreamUrl?.trim() ?? ''
    if (!url) errors.upstreamUrl = 'Upstream URL is required'
    else if (!isHttpUrl(url)) errors.upstreamUrl = 'Enter an http or https URL'
  }

  if (!input.groupId) errors.groupId = 'Pick a group'
  if (!input.owner.trim()) errors.owner = 'Owner is required'
  return errors
}

// Stand-in for the real /health ping (A-02): deterministic so demos and tests are repeatable.
export function checkReachable(rawUrl: string): ConnectionResult {
  if (!isHttpUrl(rawUrl)) return { reachable: false, error: 'Only http and https URLs are supported' }
  const host = new URL(rawUrl).hostname
  if (host.includes('unreachable')) return { reachable: false, error: `Can't reach ${rawUrl}: host not found` }
  return { reachable: true, latencyMs: latencyFor(host) }
}

function latencyFor(host: string): number {
  let hash = 0
  for (const char of host) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return 80 + (hash % 161)
}
