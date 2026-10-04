import { useInfiniteQuery, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/context'
import { ApiError, getJson } from './client'
import type { AuditEventPage, AuditFilters, AuditRule, SessionFilters, SessionPage } from './types'

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

export const auditKeys = {
  events: (filters: AuditFilters) => ['audit-events', filters] as const,
  rules: ['audit-rules'] as const,
  sessions: (filters: SessionFilters) => ['sessions', filters] as const,
}

/** 404/405: this API deployment doesn't have A-07 yet. */
export function isMissingEndpoint(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405)
}

export function useAuditEvents(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: auditKeys.events(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getJson<AuditEventPage>(withQuery('/audit-events', { ...filters, before: pageParam })),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

export function useAuditRules() {
  return useQuery({ queryKey: auditKeys.rules, queryFn: () => getJson<AuditRule[]>('/audit-events/rules') })
}

export function useSessions(filters: SessionFilters) {
  return useInfiniteQuery({
    queryKey: auditKeys.sessions(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getJson<SessionPage>(withQuery('/sessions', { ...filters, before: pageParam })),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

/** #102: refetch these queries when rows of these tables change (Supabase Realtime, RLS applies).
 * A burst of changes causes one refetch. Returns whether the subscription is live; without realtime
 * it stays false and the page's Refresh button is the way to update. */
export function useLiveRefresh(tables: readonly string[], queryKeys: readonly QueryKey[]): boolean {
  const { watchTables } = useAuth()
  const queryClient = useQueryClient()
  const [live, setLive] = useState(false)
  // Callers pass literals; compare by value so a new array each render doesn't resubscribe.
  const tablesKey = JSON.stringify(tables)
  const queryKeysKey = JSON.stringify(queryKeys)

  useEffect(() => {
    if (!watchTables) return
    const keys = JSON.parse(queryKeysKey) as QueryKey[]
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = watchTables(
      JSON.parse(tablesKey) as string[],
      () => {
        clearTimeout(timer)
        timer = setTimeout(() => keys.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey })), 300)
      },
      setLive,
    )
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [watchTables, tablesKey, queryKeysKey, queryClient])

  return live
}
