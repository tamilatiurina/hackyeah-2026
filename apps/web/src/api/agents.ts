import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getJson, postJson } from './client'
import type { Agent, AgentList, AgentRegistration } from './types'

export const agentKeys = { agents: ['agents'] as const }

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.agents,
    queryFn: async () => (await getJson<AgentList>('/agents')).data,
  })
}

export function useRegisterAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (registration: AgentRegistration) => postJson<Agent>('/agents', registration),
    onSuccess: (agent) => {
      // The API lists newest first.
      queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => [agent, ...(old ?? [])])
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents })
    },
  })
}
