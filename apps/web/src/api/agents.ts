import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteJson, getJson, patchJson, postJson } from './client'
import type { Agent, AgentList, AgentRegistration, AgentUpdate, GatewayKey, ReviewableStep } from './types'

export const agentKeys = {
  agents: ['agents'] as const,
  agent: (id: string) => ['agents', id] as const,
}

const enc = encodeURIComponent

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.agents,
    queryFn: async () => (await getJson<AgentList>('/agents')).data,
  })
}

export function useAgent(id: string) {
  return useQuery({ queryKey: agentKeys.agent(id), queryFn: () => getJson<Agent>(`/agents/${enc(id)}`) })
}

export function useRegisterAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (registration: AgentRegistration) => postJson<Agent>('/agents', registration),
    onSuccess: (agent) => {
      // The API lists newest first.
      queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => [agent, ...(old ?? [])])
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents, exact: true })
    },
  })
}

/** Puts a changed agent into both the detail and the list cache. */
function useStoreAgent() {
  const queryClient = useQueryClient()
  return (id: string, update: (agent: Agent) => Agent) => {
    queryClient.setQueryData<Agent>(agentKeys.agent(id), (old) => (old ? update(old) : old))
    queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => old?.map((a) => (a.id === id ? update(a) : a)))
  }
}

export function useUpdateAgent(id: string) {
  const store = useStoreAgent()
  return useMutation({
    mutationFn: (changes: AgentUpdate) => patchJson<Agent>(`/agents/${enc(id)}`, changes),
    onSuccess: (agent) => store(id, () => agent),
  })
}

/** Marks a setup step finished without attaching anything; the config version stays the same. */
export function useCompleteSetupStep(id: string) {
  const store = useStoreAgent()
  return useMutation({
    mutationFn: (step: ReviewableStep) => postJson<Agent>(`/agents/${enc(id)}/setup/${step}`, {}),
    onSuccess: (agent) => store(id, () => agent),
  })
}

/** The test chat completed the Test step on the server; mirror it without a refetch. */
export function useMarkTested(id: string) {
  const store = useStoreAgent()
  return () => store(id, (agent) => (agent.tested ? agent : { ...agent, tested: true }))
}

export function useDeleteAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/agents/${enc(id)}`),
    onSuccess: (_, id) => {
      // The detail query is left alone: removing it while the page is still mounted would refetch → 404.
      queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => old?.filter((a) => a.id !== id))
    },
  })
}

/** Creates the agent's gateway key, replacing (rotating) any previous one. The agent goes live. */
export function useCreateGatewayKey(id: string) {
  const store = useStoreAgent()
  return useMutation({
    mutationFn: () => postJson<GatewayKey>(`/agents/${enc(id)}/gateway-key`, {}),
    onSuccess: () => store(id, (agent) => ({ ...agent, has_gateway_key: true })),
  })
}

/** Revokes the gateway key: the guarded URL answers 401 until a new key is created. */
export function useRevokeGatewayKey(id: string) {
  const store = useStoreAgent()
  return useMutation({
    mutationFn: () => deleteJson(`/agents/${enc(id)}/gateway-key`),
    onSuccess: () => store(id, (agent) => ({ ...agent, has_gateway_key: false })),
  })
}
