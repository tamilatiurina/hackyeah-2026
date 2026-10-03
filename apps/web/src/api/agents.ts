import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getJson, postJson } from './client'
import type { Agent, ConnectionResult, Group, RegisterAgentInput } from './types'

export const agentKeys = {
  agents: ['agents'] as const,
  groups: ['groups'] as const,
}

export function useAgents() {
  return useQuery({ queryKey: agentKeys.agents, queryFn: () => getJson<Agent[]>('/agents') })
}

export function useGroups() {
  return useQuery({ queryKey: agentKeys.groups, queryFn: () => getJson<Group[]>('/groups') })
}

export function useRegisterAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RegisterAgentInput) => postJson<Agent>('/agents', input),
    onSuccess: (agent) => {
      // Show the new row immediately, then refetch to stay in sync with the server.
      queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => (old ? [...old, agent] : [agent]))
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents })
    },
  })
}

export function useCreateGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => postJson<Group>('/groups', { name }),
    onSuccess: (group) => {
      queryClient.setQueryData<Group[]>(agentKeys.groups, (old) => (old ? [...old, group] : [group]))
      void queryClient.invalidateQueries({ queryKey: agentKeys.groups })
    },
  })
}

export function testConnection(upstreamUrl: string): Promise<ConnectionResult> {
  return postJson<ConnectionResult>('/agents/test-connection', { upstreamUrl })
}
