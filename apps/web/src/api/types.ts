// Hand-written until T-02 (#29) lands; replace with the types generated from the OpenAPI spec.

export interface Group {
  id: string
  name: string
}

export type AgentMode = 'proxy' | 'runtime'

interface AgentBase {
  id: string
  name: string
  groupId: string
  owner: string
  ruleCount: number
}

export interface ProxyAgent extends AgentBase {
  mode: 'proxy'
  upstreamUrl: string
  status: 'draft' | 'deployed'
  version: number | null
}

export interface RuntimeAgent extends AgentBase {
  mode: 'runtime'
  online: boolean
  lastSeenAt: string | null // ISO 8601
}

export type Agent = ProxyAgent | RuntimeAgent

export interface RegisterAgentInput {
  mode: AgentMode
  name: string
  groupId: string
  owner: string
  upstreamUrl?: string // required when mode is 'proxy'
}

export interface ConnectionResult {
  reachable: boolean
  latencyMs?: number
  error?: string
}

export interface ApiErrorBody {
  message: string
  field?: string
}
