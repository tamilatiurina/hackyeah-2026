export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export interface AgentForm {
  name: string
  description: string
  upstreamUrl: string
  sendAuthHeader: boolean
  authHeaderName: string
  authHeaderValue: string
}

export type AgentFormField = 'name' | 'description' | 'upstreamUrl' | 'authHeaderName' | 'authHeaderValue'
export type AgentFormErrors = Partial<Record<AgentFormField, string>>

/** Same limits as apps/api AgentRegistration. */
export function validateAgentForm(form: AgentForm): AgentFormErrors {
  const errors: AgentFormErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Name is required'
  else if (name.length > 100) errors.name = 'Use at most 100 characters'
  if (form.description.length > 1000) errors.description = 'Use at most 1,000 characters'
  const url = form.upstreamUrl.trim()
  if (!url) errors.upstreamUrl = 'Upstream URL is required'
  else if (!isHttpUrl(url)) errors.upstreamUrl = 'Enter an http or https URL'
  if (form.sendAuthHeader) {
    if (!form.authHeaderName.trim()) errors.authHeaderName = 'Header name is required'
    if (!form.authHeaderValue) errors.authHeaderValue = 'Header value is required'
  }
  return errors
}

export function hasErrors(errors: AgentFormErrors): boolean {
  return Object.values(errors).some(Boolean)
}
