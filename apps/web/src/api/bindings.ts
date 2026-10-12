import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteJson, getJson, patchJson, postJson } from './client'
import type { Binding, BindingUpdate, EffectivePolicy } from './types'

// FR-05: guardrails attached to an agent (the API also supports role and user scopes).
export const bindingKeys = {
  agent: (agentId: string) => ['bindings', 'agent', agentId] as const,
  allAgents: ['bindings', 'all-agents'] as const,
  effective: (agentId: string) => ['effective-guardrails', agentId] as const,
}

const enc = encodeURIComponent

export function useAgentBindings(agentId: string) {
  return useQuery({
    queryKey: bindingKeys.agent(agentId),
    queryFn: async () => {
      const list = await getJson<Binding[]>(`/bindings?scope_type=agent&scope_id=${enc(agentId)}`)
      // The API sorts by order_index; keep that, stable for equal values.
      return [...list].sort((a, b) => a.order_index - b.order_index)
    },
  })
}

/** Every agent's bindings in one call, for the agents list. */
export function useAllAgentBindings() {
  return useQuery({
    queryKey: bindingKeys.allAgents,
    queryFn: () => getJson<Binding[]>('/bindings?scope_type=agent'),
  })
}

export function useEffectiveGuardrails(agentId: string) {
  return useQuery({
    queryKey: bindingKeys.effective(agentId),
    queryFn: () => getJson<EffectivePolicy>(`/effective-guardrails?agent_id=${enc(agentId)}`),
  })
}

function useRefresh(agentId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: bindingKeys.agent(agentId) }),
      queryClient.invalidateQueries({ queryKey: bindingKeys.allAgents }),
      queryClient.invalidateQueries({ queryKey: bindingKeys.effective(agentId) }),
    ])
}

export function useAttachGuardrail(agentId: string) {
  const refresh = useRefresh(agentId)
  return useMutation({
    mutationFn: ({ guardrailId, orderIndex }: { guardrailId: string; orderIndex: number }) =>
      postJson<Binding>('/bindings', {
        scope_type: 'agent',
        scope_id: agentId,
        guardrail_id: guardrailId,
        order_index: orderIndex,
        enabled: true,
      }),
    onSettled: refresh,
  })
}

export function useUpdateBinding(agentId: string) {
  const refresh = useRefresh(agentId)
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: BindingUpdate }) =>
      patchJson<Binding>(`/bindings/${enc(id)}`, changes),
    onSettled: refresh,
  })
}

/** Gives each binding its position as order_index; only bindings whose value changes are sent. */
export function useReorderBindings(agentId: string) {
  const refresh = useRefresh(agentId)
  return useMutation({
    mutationFn: async (ordered: Binding[]) => {
      for (const [position, binding] of ordered.entries()) {
        if (binding.order_index !== position) {
          await patchJson<Binding>(`/bindings/${enc(binding.id)}`, { order_index: position })
        }
      }
    },
    onSettled: refresh,
  })
}

export function useDetachBinding(agentId: string) {
  const refresh = useRefresh(agentId)
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/bindings/${enc(id)}`),
    onSettled: refresh,
  })
}
