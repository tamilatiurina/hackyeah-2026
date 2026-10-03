// pi control layer policy (mirror packages/pi-control-layer/policy.schema.json).
// The schema is the source of truth; keep these types in sync with it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getJson, postJson, putJson } from './client'

export type EnforcementMode = 'block' | 'warn'

export interface CommandRule {
  id: string
  pattern: string
  reason?: string
  timeoutSeconds?: number | null // approval rules only
  enabled?: boolean
}

export interface FileRule {
  id: string
  pattern: string
  reason?: string
  timeoutSeconds?: number | null
  enabled?: boolean
}

export interface RegexRule {
  id: string
  regex: string
  replacement?: string
}

export interface RedactRule {
  id: string
  pattern: string
  redactionPatterns: RegexRule[]
  enabled?: boolean
}

export interface CommandSection {
  banned?: CommandRule[]
  approval?: CommandRule[]
  outputRedact?: CommandRule[]
}

export interface FileSection {
  blocked?: FileRule[]
  redact?: RedactRule[]
  approval?: FileRule[]
}

export interface BudgetSection {
  maxSessionCostUsd?: number
  maxTurnCostUsd?: number
  maxSessionTokens?: number
  maxTurnTokens?: number
  onExceed?: EnforcementMode
}

export interface TimeSection {
  maxTurnSeconds?: number
  maxSessionSeconds?: number
  alertAfterSeconds?: number
  onExceed?: EnforcementMode
}

export interface SystemPromptSection {
  mode?: 'append' | 'replace' | 'none'
  text?: string
}

export interface InjectionSection {
  enabled?: boolean
  onDetect?: EnforcementMode
  patterns?: RegexRule[]
  scanToolResults?: boolean
  scanUserInput?: boolean
}

export interface ControlPlaneSection {
  url?: string
  localFallback?: 'confirm' | 'block' | 'allow'
}

export interface IdentitySection {
  owner?: string
}

export interface AgentPolicy {
  identity?: IdentitySection
  commands?: CommandSection
  files?: FileSection
  budget?: BudgetSection
  time?: TimeSection
  systemPrompt?: SystemPromptSection
  injection?: InjectionSection
  controlPlane?: ControlPlaneSection
}

export interface PiPolicy {
  version: 1
  defaults?: AgentPolicy
  agents?: Record<string, AgentPolicy>
}

export interface PiPolicyMeta {
  path: string
  lastModifiedUtc: string | null
  sha256: string | null
  sizeBytes: number | null
}

export interface PiPolicyResponse extends PiPolicyMeta {
  policy: PiPolicy
}

export interface SchemaError {
  jsonPath: string
  message: string
}

export interface ValidateResult {
  valid: boolean
  errors: SchemaError[]
}

export interface BackupInfo {
  id: string
  lastModifiedUtc: string
  sizeBytes: number
}

export const piPolicyKeys = {
  policy: ['pi-policy'] as const,
  backups: ['pi-policy-backups'] as const,
}

export function usePiPolicy() {
  return useQuery({
    queryKey: piPolicyKeys.policy,
    queryFn: () => getJson<PiPolicyResponse>('/pi/policy'),
  })
}

interface SaveInput {
  policy: PiPolicy
  etag: string | null
}

export function useSavePiPolicy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ policy, etag }: SaveInput) =>
      putJson<PiPolicyResponse>('/pi/policy', { policy }, etag ? { 'If-Match': `"${etag}"` } : {}),
    onSuccess: (saved) => {
      queryClient.setQueryData(piPolicyKeys.policy, saved)
    },
  })
}

export function validatePiPolicy(policy: PiPolicy): Promise<ValidateResult> {
  return postJson<ValidateResult>('/pi/policy/validate', { policy })
}

export function usePiPolicyBackups() {
  return useQuery({ queryKey: piPolicyKeys.backups, queryFn: () => getJson<BackupInfo[]>('/pi/policy/backups') })
}
