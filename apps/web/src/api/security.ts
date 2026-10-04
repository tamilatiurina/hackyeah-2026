import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { getJson, streamNdjson } from './client'

// SEC-01: OWASP LLM Top 10 (2025) scans. Shapes match apps/api/app/security/models.py.

export type ScanVerdict = 'vulnerable' | 'defended' | 'inconclusive'

export interface ScanCategory {
  id: string
  name: string
  testable: boolean
}

export interface RunResult {
  verdict: ScanVerdict
  reason: string
  evidence: string
  stoppedBy: string | null
}

export interface ProbeResult {
  probeId: string
  category: string
  title: string
  attack: string
  unguarded: RunResult
  guarded: RunResult
}

export interface StaticCheck {
  category: string
  title: string
  status: 'passed' | 'warning' | 'not_testable'
  detail: string
}

export interface RunTotals {
  vulnerable: number
  defended: number
  inconclusive: number
}

export interface ScanSummary {
  total: number
  unguarded: RunTotals
  guarded: RunTotals
  stopped: number
}

export interface ScanListItem {
  id: string
  agentId: string
  createdAt: string
  policyVersion: string
  summary: ScanSummary
}

export interface ScanRecord extends ScanListItem {
  categories: ScanCategory[]
  staticChecks: StaticCheck[]
  results: ProbeResult[]
}

type ScanEvent =
  | {
      type: 'start'
      scanId: string
      total: number
      probes: PlannedProbe[]
      judge: boolean
      categories: ScanCategory[]
      staticChecks: StaticCheck[]
    }
  | { type: 'probe'; result: ProbeResult }
  | { type: 'error'; message: string }
  | { type: 'summary'; scan: ScanRecord }

/** A probe announced at the start of a scan, before its result arrives. */
export interface PlannedProbe {
  probeId: string
  category: string
  title: string
}

/** What the page shows while a scan streams in, and after. */
export interface LiveScan {
  running: boolean
  total: number
  probes: PlannedProbe[]
  judge: boolean
  categories: ScanCategory[]
  staticChecks: StaticCheck[]
  results: ProbeResult[]
  scan: ScanRecord | null
  warning: string | null
  error: string | null
}

const enc = encodeURIComponent
const IDLE: LiveScan = {
  running: false,
  total: 0,
  probes: [],
  judge: true,
  categories: [],
  staticChecks: [],
  results: [],
  scan: null,
  warning: null,
  error: null,
}

export const securityKeys = {
  scans: (agentId: string) => ['security-scans', agentId] as const,
  scan: (scanId: string) => ['security-scan', scanId] as const,
}

export function useSecurityScans(agentId: string) {
  return useQuery({
    queryKey: securityKeys.scans(agentId),
    queryFn: () => getJson<ScanListItem[]>(`/agents/${enc(agentId)}/security-scans`),
    enabled: Boolean(agentId),
  })
}

export function useSecurityScan(scanId: string | null) {
  return useQuery({
    queryKey: securityKeys.scan(scanId ?? ''),
    queryFn: () => getJson<ScanRecord>(`/security-scans/${enc(scanId ?? '')}`),
    enabled: Boolean(scanId),
  })
}

/** Starts a scan and collects its streamed events; one scan at a time. */
export function useRunSecurityScan() {
  const queryClient = useQueryClient()
  const [live, setLive] = useState<LiveScan>(IDLE)
  const runId = useRef(0)

  const run = useCallback(
    async (agentId: string) => {
      const id = ++runId.current
      const update = (changes: (current: LiveScan) => Partial<LiveScan>) => {
        if (id === runId.current) setLive((current) => ({ ...current, ...changes(current) }))
      }
      setLive({ ...IDLE, running: true })
      try {
        await streamNdjson(`/agents/${enc(agentId)}/security-scans`, (raw) => {
          const event = raw as ScanEvent
          if (event.type === 'start') {
            const { total, probes, judge, categories, staticChecks } = event
            update(() => ({ total, probes, judge, categories, staticChecks }))
          } else if (event.type === 'probe') {
            update((current) => ({ results: [...current.results, event.result] }))
          } else if (event.type === 'error') {
            update(() => ({ warning: event.message }))
          } else if (event.type === 'summary') {
            update(() => ({ scan: event.scan, results: event.scan.results }))
          }
        })
        update(() => ({ running: false }))
      } catch (e) {
        update(() => ({ running: false, error: e instanceof Error ? e.message : 'The scan failed' }))
      }
      void queryClient.invalidateQueries({ queryKey: securityKeys.scans(agentId) })
    },
    [queryClient],
  )

  const reset = useCallback(() => {
    runId.current += 1
    setLive(IDLE)
  }, [])

  return { live, run, reset }
}
