import { useState } from 'react'
import { Link } from 'react-router'
import type { RunResult, Scenario } from '../../api/playground'
import { usePlaygroundHosts, useResetSandbox, useRunScenario, useScenarios } from '../../api/playground'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'

const EXPECTED_LABELS: Record<Scenario['expected'], { label: string; className: string }> = {
  blocked: { label: 'Expected: blocked', className: 'bg-[#FBE7E2] text-danger' },
  redacted: { label: 'Expected: redacted', className: 'bg-warn-bg text-warn-fg' },
  passes: { label: 'Expected: passes', className: 'bg-teal-soft text-teal-dark' },
}

export function PlaygroundPage() {  const scenarios = useScenarios()
  const hosts = usePlaygroundHosts()
  const [host, setHost] = useState<string | null>(null) // null = first option once loaded
  const [results, setResults] = useState<Record<string, RunResult | 'running'>>({})
  const [resetNote, setResetNote] = useState<string | null>(null)
  const run = useRunScenario()
  const reset = useResetSandbox()

  const selectedHost = host ?? hosts.data?.[0]?.id ?? ''
  const anyRunning = Object.values(results).some((r) => r === 'running') || reset.isPending

  const doReset = () => {
    setResetNote(null)
    reset.mutate(undefined, {
      onSuccess: (res) => setResetNote(`Sandbox restored (${res.staged.length} files re-created).`),
      onError: (error) => setResetNote((error as { message?: string }).message ?? 'Reset failed.'),
    })
  }

  const startRun = (scenarioId: string) => {
    if (anyRunning) return
    setResults((prev) => ({ ...prev, [scenarioId]: 'running' }))
    run.mutate(
      { scenarioId, host: selectedHost },
      {
        onSuccess: (result) => setResults((prev) => ({ ...prev, [scenarioId]: result })),
        onError: (error) =>
          setResults((prev) => ({
            ...prev,
            [scenarioId]: {
              scenarioId,
              host: selectedHost,
              exitCode: null,
              durationMs: 0,
              stdout: '',
              stderr: (error as { message?: string }).message ?? 'Run failed.',
              timedOut: false,
            },
          })),
      },
    )
  }

  if (scenarios.isError || hosts.isError) {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-6">
        <span className="text-sm">Couldn't load the playground scenarios.</span>
        <span className="text-[13px] text-muted">
          Is the API running? Start it with <code className="font-mono">make api</code>.
        </span>
        <div>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => {
              void scenarios.refetch()
              void hosts.refetch()
            }}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="mr-auto max-w-2xl">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Playground</h1>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[#30343B]">Simulated host</span>
          <select
            aria-label="Simulated host"
            className="min-h-11 rounded-lg border border-[#CFCFC8] bg-surface px-3 text-sm text-ink"
            value={selectedHost}
            onChange={(e) => setHost(e.target.value)}
          >
            {(hosts.data ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[#30343B]">Sandbox</span>
          <button type="button" className={buttonSecondary} disabled={reset.isPending || anyRunning} onClick={doReset}>
            {reset.isPending ? 'Restoring…' : 'Reset sandbox'}
          </button>
        </label>
      </header>

      {resetNote && (
        <div role="status" className="rounded-lg border border-line bg-surface p-3 text-sm text-muted">
          {resetNote}
        </div>
      )}

      <div className="rounded-xl border border-[#EAD3A2] bg-warn-bg p-4 text-sm text-warn-fg">
        <b>How to demo:</b> run a failing scenario (it should be blocked or redacted per the policy), open{' '}
        <Link to="/policies" className="font-semibold underline">
          Policies
        </Link>{' '}
        and relax the matching rule (the hint on each card says which), so the scenario passes. Refresh the environment if needed.
      </div>

      {!scenarios.data ? (
        <div aria-busy="true" className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {scenarios.data.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              disabled={anyRunning || run.isPending}
              result={results[scenario.id]}
              onRun={() => startRun(scenario.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ScenarioCard({
  scenario,
  disabled,
  result,
  onRun,
}: {
  scenario: Scenario
  disabled: boolean
  result: RunResult | 'running' | undefined
  onRun: () => void
}) {
  const expected = EXPECTED_LABELS[scenario.expected]
  return (
    <article
      aria-label={scenario.title}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">{scenario.title}</h2>
        <span className={`inline-flex shrink-0 rounded-md px-2.5 py-0.5 text-xs font-semibold ${expected.className}`}>
          {expected.label}
        </span>
      </div>
      <p className="m-0 text-[13px] text-muted">{scenario.hint}</p>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none">Exact prompt sent to the agent</summary>
        <code className="mt-2 block rounded bg-canvas p-2 font-mono whitespace-pre-wrap">{scenario.prompt}</code>
      </details>
      <div className="mt-auto">
        <button type="button" className={buttonPrimary} disabled={disabled} onClick={onRun}>
          {result === 'running' ? 'Running…' : 'Run scenario'}
        </button>
      </div>
      {result === 'running' && (
        <div aria-busy="true" className="animate-pulse rounded-lg border border-line bg-canvas p-3 text-xs text-muted">
          The pi agent is working on it — usually done in a few seconds.
        </div>
      )}
      {result && result !== 'running' && <RunTranscript result={result} />}
    </article>
  )
}

function RunTranscript({ result }: { result: RunResult }) {
  const failed = result.timedOut || result.stderr !== ''
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {result.exitCode !== null && <span>exit code {result.exitCode}</span>}
        {result.durationMs > 0 && <span>{(result.durationMs / 1000).toFixed(1)}s</span>}
        {result.timedOut && <span className="font-semibold text-danger">timed out</span>}
        {result.host && <span>host {result.host}</span>}
      </div>
      {result.stdout && (
        <pre className="m-0 max-h-64 overflow-auto rounded bg-surface p-2 font-mono text-[12.5px] whitespace-pre-wrap">
          {result.stdout}
        </pre>
      )}
      {result.stderr && (
        <pre className="m-0 max-h-40 overflow-auto rounded bg-[#FBE7E2] p-2 font-mono text-[12.5px] whitespace-pre-wrap text-danger">
          {result.stderr}
        </pre>
      )}
      {!result.stdout && !result.stderr && !failed && (
        <span className="text-xs text-muted">(no output)</span>
      )}
    </div>
  )
}
