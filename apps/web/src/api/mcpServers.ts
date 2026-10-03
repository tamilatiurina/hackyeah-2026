import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteJson, getJson, postJson } from './client'
import type { McpServer, McpServerCreate } from './types'

export const mcpServerKeys = { servers: ['mcp-servers'] as const }

export function useMcpServers() {
  return useQuery({ queryKey: mcpServerKeys.servers, queryFn: () => getJson<McpServer[]>('/mcp-servers') })
}

export function useRegisterMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (server: McpServerCreate) => postJson<McpServer>('/mcp-servers', server),
    onSuccess: (server) => {
      queryClient.setQueryData<McpServer[]>(mcpServerKeys.servers, (old) => [...(old ?? []), server])
      void queryClient.invalidateQueries({ queryKey: mcpServerKeys.servers })
    },
  })
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/mcp-servers/${encodeURIComponent(id)}`),
    onSuccess: (_, id) => {
      queryClient.setQueryData<McpServer[]>(mcpServerKeys.servers, (old) => old?.filter((s) => s.id !== id))
    },
  })
}
