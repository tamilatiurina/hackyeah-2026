// pi playground: predefined safe scenarios run through `pi -p` with the control-layer
// extension, showing live policy enforcement. See apps/api/app/pi_policy/playground.py.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getJson, postJson } from './client'

export interface Scenario {
  id: string
  title: string
  prompt: string
  expected: 'blocked' | 'redacted' | 'passes' | 'flagged'
  hint: string
}

export interface HostOption {
  id: string
  label: string
}

export interface RunResult {
  scenarioId: string
  host: string
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export const playgroundKeys = {
  scenarios: ['pi-playground-scenarios'] as const,
  hosts: ['pi-playground-hosts'] as const,
}

export function useScenarios() {
  return useQuery({
    queryKey: playgroundKeys.scenarios,
    queryFn: () => getJson<Scenario[]>('/pi/playground/scenarios'),
    staleTime: Infinity,
  })
}

export function usePlaygroundHosts() {
  return useQuery({ queryKey: playgroundKeys.hosts, queryFn: () => getJson<HostOption[]>('/pi/playground/hosts') })
}

export function useRunScenario() {
  return useMutation({
    mutationFn: (input: { scenarioId: string; host: string }) =>
      postJson<RunResult>('/pi/playground/run', input),
  })
}

export interface ResetSandboxResult {
  staged: string[]
  sandboxDir: string
}

export function useResetSandbox() {
  return useMutation({
    mutationFn: () => postJson<ResetSandboxResult>('/pi/playground/reset-sandbox', {}),
  })
}

// --- incidents (.pi/incidents.json, written by the extension on injection detection) ---

export interface Incident {
  ts: string
  agent: string
  event: string
  scope: string // 'defaults' (global config) or the host the rule came from
  hits: string[]
  mode: 'warn' | 'block' | 'redacted'
  tool: string | null
  detail: string
  url: string | null
  autoBanned: boolean
}

export const incidentKeys = {
  incidents: ['pi-incidents'] as const,
}

export function useIncidents() {
  return useQuery({
    queryKey: incidentKeys.incidents,
    queryFn: () => getJson<Incident[]>('/pi/incidents'),
    // the extension appends to the file behind our back; never cache stale lists
    staleTime: 0,
  })
}

export function useBanLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => postJson<{ ruleId: string; url: string }>('/pi/incidents/ban-link', { url }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: incidentKeys.incidents })
    },
  })
}

export function useUnbanLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => postJson<{ ruleId: string; removed: number }>('/pi/incidents/unban-link', { url }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: incidentKeys.incidents })
    },
  })
}

// --- sessions (pi session JSONL inventory) ---

export interface SessionSummary {
  id: string
  timestamp: string
  cwd: string
  projectDir: string
  model: string
  messages: number
  toolCalls: number
  totalTokens: number
  cacheTokens: number
  costUsd: number | null
  durationMs: number | null
  title: string
  fromPlayground: boolean
}

export interface SessionsStats {
  sessionCount: number
  totalCostUsd: number
  totalTokens: number
  totalCacheTokens: number
  totalToolCalls: number
  avgCostUsd: number
  avgTokens: number
  avgDurationMs: number
  projects: Record<string, number>
}

export interface SessionsOverview {
  sessions: SessionSummary[]
  stats: SessionsStats
}

export const sessionKeys = {
  sessions: ['pi-sessions'] as const,
}

export function usePiSessions() {
  return useQuery({
    queryKey: sessionKeys.sessions,
    queryFn: () => getJson<SessionsOverview>('/pi/sessions'),
    // new sessions appear outside the app (every pi run, every playground run)
    staleTime: 0,
  })
}
