import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteJson, getJson, putJson } from './client'
import { mcpServerKeys } from './mcpServers'
import type { AgentMcpServer } from './types'

const enc = encodeURIComponent
export const agentMcpKeys = { servers: (agentId: string) => ['agent-mcp-servers', agentId] as const }

/** FR-17: the MCP servers this agent may use, with its tools. */
export function useAgentMcpServers(agentId: string) {
  return useQuery({
    queryKey: agentMcpKeys.servers(agentId),
    queryFn: () => getJson<AgentMcpServer[]>(`/agents/${enc(agentId)}/mcp-servers`),
  })
}

/** Grant a server with exactly these tools: attaches it, or replaces the selection. */
export function useSetAgentMcpServer(agentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ serverId, tools }: { serverId: string; tools: string[] }) =>
      putJson<AgentMcpServer>(`/agents/${enc(agentId)}/mcp-servers/${enc(serverId)}`, { allowed_tools: tools }),
    onSuccess: (entry) => {
      queryClient.setQueryData<AgentMcpServer[]>(agentMcpKeys.servers(agentId), (old) => {
        const list = old ?? []
        return list.some((e) => e.server_id === entry.server_id)
          ? list.map((e) => (e.server_id === entry.server_id ? entry : e))
          : [...list, entry]
      })
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.servers }) // agent counts
    },
  })
}

export function useRemoveAgentMcpServer(agentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) => deleteJson(`/agents/${enc(agentId)}/mcp-servers/${enc(serverId)}`),
    onSuccess: (_, serverId) => {
      queryClient.setQueryData<AgentMcpServer[]>(agentMcpKeys.servers(agentId), (old) =>
        old?.filter((e) => e.server_id !== serverId),
      )
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.servers })
    },
  })
}
