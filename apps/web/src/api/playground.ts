// pi playground: predefined safe scenarios run through `pi -p` with the control-layer
// extension, showing live policy enforcement. See apps/api/app/pi_policy/playground.py.
import { useMutation, useQuery } from '@tanstack/react-query'
import { getJson, postJson } from './client'

export interface Scenario {
  id: string
  title: string
  prompt: string
  expected: 'blocked' | 'redacted' | 'passes'
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
