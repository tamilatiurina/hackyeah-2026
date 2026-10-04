import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteJson, getJson, patchJson, postJson } from './client'
import type { McpServer, McpServerCreate, McpServerUpdate } from './types'

export const mcpServerKeys = { servers: ['mcp-servers'] as const }

export function useMcpServers() {
  // One retry: a broken API should show its error, not spin through three retries.
  return useQuery({ queryKey: mcpServerKeys.servers, queryFn: () => getJson<McpServer[]>('/mcp-servers'), retry: 1 })
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
      void queryClient.invalidateQueries({ queryKey: ['agent-mcp-servers'] }) // detached everywhere
    },
  })
}

export function useUpdateMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: McpServerUpdate }) =>
      patchJson<McpServer>(`/mcp-servers/${encodeURIComponent(id)}`, changes),
    onSuccess: (server) => {
      queryClient.setQueryData<McpServer[]>(mcpServerKeys.servers, (old) => old?.map((s) => (s.id === server.id ? server : s)))
      // Dropped tools are removed from agents too.
      void queryClient.invalidateQueries({ queryKey: ['agent-mcp-servers'] })
    },
  })
}
