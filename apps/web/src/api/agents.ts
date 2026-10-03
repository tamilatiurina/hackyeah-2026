import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteJson, getJson, patchJson, postJson } from './client'
import type { Agent, AgentList, AgentRegistration, AgentUpdate, GatewayKey } from './types'

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

export function useUpdateAgent(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: AgentUpdate) => patchJson<Agent>(`/agents/${enc(id)}`, changes),
    onSuccess: (agent) => {
      queryClient.setQueryData(agentKeys.agent(id), agent)
      queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => old?.map((a) => (a.id === agent.id ? agent : a)))
    },
  })
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

/** Creates the agent's gateway key, replacing any previous one. */
export function useCreateGatewayKey(id: string) {
  return useMutation({ mutationFn: () => postJson<GatewayKey>(`/agents/${enc(id)}/gateway-key`, {}) })
}
