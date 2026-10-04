import { useMemo, useState } from 'react'
import type { AgentPolicy, PiPolicy, SchemaError } from '../../api/piPolicy'
import { apiPath } from '../../api/client'
import { usePiPolicy, useSavePiPolicy, validatePiPolicy } from '../../api/piPolicy'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { AgentPolicyEditor } from './AgentPolicyEditor'
import { newAgentPolicy } from './policyDisplay'

const bannerBase = 'rounded-lg border p-3 text-sm'

interface SaveState {
  kind: 'idle' | 'saving' | 'saved' | 'error'
  message?: string
  errors?: SchemaError[]
  stale?: boolean
}

export function PolicyPage() {
  const query = usePiPolicy()
  const saveMutation = useSavePiPolicy()
  const [draft, setDraft] = useState<PiPolicy | null>(null)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const [confirming, setConfirming] = useState<string | null>(null)

  const loaded = query.data
  const dirty = useMemo(
    () => loaded != null && draft != null && JSON.stringify(draft) !== JSON.stringify(loaded.policy),
    [loaded, draft],
  )

  const current: PiPolicy | null = loaded && draft ? draft : (loaded?.policy ?? null)

  const update = (next: PiPolicy) => {
    setDraft(next)
    setSaveState({ kind: 'idle' })
  }

  const updateDefaults = (defaults: AgentPolicy) => current && update({ ...current, defaults })

  const updateAgent = (name: string, policy: AgentPolicy | undefined) => {
    if (!current) return
    const agents = { ...(current.agents ?? {}) }
    if (policy === undefined) delete agents[name]
    else agents[name] = policy
    update({ ...current, agents: Object.keys(agents).length > 0 ? agents : undefined })
  }

  const addAgent = (name: string) => {
    if (!current) return
    const trimmed = name.trim()
    if (!trimmed || current.agents?.[trimmed]) return
    update({ ...current, agents: { ...(current.agents ?? {}), [trimmed]: newAgentPolicy() } })
  }

  const save = async () => {
    if (!current || !loaded) return
    setSaveState({ kind: 'saving' })
    try {
      const check = await validatePiPolicy(current)
      if (!check.valid) {
        setSaveState({ kind: 'error', message: 'Schema validation failed:', errors: check.errors })
        return
      }
      const saved = await saveMutation.mutateAsync({ policy: current, etag: loaded.sha256 })
      setDraft(null)
      setSaveState({ kind: 'saved', message: 'Saved. The pi extension picks the change up on its next read.' })
      void saved
    } catch (error) {
      const err = error as { status?: number; message?: string; field?: string }
      if (err.status === 412) {
        setSaveState({
          kind: 'error',
          stale: true,
          message: 'The policy file changed on disk since you loaded it. Reload to get the latest version, then re-apply your changes.',
        })
        return
      }
      setSaveState({ kind: 'error', message: err.message ?? 'Saving failed.' })
    }
  }

  const reload = () => {
    setDraft(null)
    setSaveState({ kind: 'idle' })
    void query.refetch()
  }

  // Restore Defaults: fetch the seed policy, validate it as the draft, and put it
  // in the editor — nothing is written until the judge hits Save changes.
  const [restoreState, setRestoreState] = useState<'idle' | 'loading'>('idle')
  const restoreDefaults = async () => {
    setRestoreState('loading')
    try {
      const res = await fetch(apiPath('/pi/policy/defaults'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { policy: PiPolicy }
      setDraft(body.policy)
      setSaveState({ kind: 'idle' })
      setRestoreState('idle')
    } catch (error) {
      setSaveState({ kind: 'error', message: (error as { message?: string }).message ?? 'Restore failed.' })
      setRestoreState('idle')
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="mr-auto">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Policies</h1>
          <p className="m-0 text-[13px] text-muted">
            {loaded ? (
              <>
                <span className="font-mono">{loaded.path}</span>
                {loaded.lastModifiedUtc && <> · modified {new Date(loaded.lastModifiedUtc).toLocaleString()}</>}
                {loaded.sizeBytes != null && <> · {loaded.sizeBytes} B</>}
              </>
            ) : (
              'pi control layer policy (.pi/policy.json)'
            )}
          </p>
        </div>
        {loaded && (
          <>
            <button
              type="button"
              className={buttonSecondary}
              disabled={restoreState === 'loading' || saveState.kind === 'saving'}
              onClick={() => void restoreDefaults()}
            >
              {restoreState === 'loading' ? 'Restoring…' : 'Restore Defaults'}
            </button>
            <button type="button" className={buttonSecondary} onClick={reload}>
              Reload
            </button>
            <button
              type="button"
              className={buttonPrimary}
              disabled={!dirty || saveState.kind === 'saving'}
              onClick={() => void save()}
            >
              {saveState.kind === 'saving' ? 'Saving…' : 'Save changes'}
            </button>
          </>
        )}
      </header>

      {query.isError && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-6">
          <span className="text-sm">Couldn't load the pi policy file.</span>
          <span className="text-[13px] text-muted">
            Is the API running? Start it with <code className="font-mono">make api</code>.
          </span>
          <div>
            <button type="button" className={buttonSecondary} onClick={() => void query.refetch()}>
              Retry
            </button>
          </div>
        </div>
      )}

      {!query.isSuccess && !query.isError && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <div className="h-10 w-72 animate-pulse rounded-lg border border-line bg-surface" />
          <div className="h-[60vh] animate-pulse rounded-xl border border-line bg-surface" />
        </div>
      )}

      {current && (
        <>
          {saveState.kind === 'saved' && (
            <div role="status" className={`${bannerBase} border-[#BFE3D2] bg-[#EAF6F0] text-[#0B5A51]`}>
              ✓ {saveState.message}
            </div>
          )}
          {saveState.kind === 'error' && (
            <div role="alert" className={`${bannerBase} border-[#EFC4BC] bg-[#FBEAE6] text-danger`}>
              {saveState.stale ? (
                <span>
                  {saveState.message}{' '}
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-teal underline"
                    onClick={reload}
                  >
                    Reload now
                  </button>
                </span>
              ) : (
                <span>{saveState.message}</span>
              )}
              {saveState.errors && saveState.errors.length > 0 && (
                <ul className="mt-2 mb-0 flex max-h-48 flex-col gap-1 overflow-auto pl-5">
                  {saveState.errors.map((e, i) => (
                    <li key={i}>
                      <code className="font-mono text-xs">{e.jsonPath}</code> — {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {dirty && saveState.kind !== 'error' && (
            <div role="status" className={`${bannerBase} border-[#EAD3A2] bg-warn-bg text-warn-fg`}>
              Unsaved changes — remember to save.
            </div>
          )}

          {/* defaults */}
          <section aria-labelledby="policy-defaults-heading" className="rounded-xl border border-line bg-surface p-5">
            <div className="mb-4 flex items-baseline gap-3">
              <h2 id="policy-defaults-heading" className="m-0 text-base font-semibold">
                Global rules
              </h2>
              <span className="text-xs text-muted">applied to every agent</span>
            </div>
            <AgentPolicyEditor value={current.defaults ?? {}} disabled={false} onChange={updateDefaults} />
          </section>

          {/* per-agent overrides */}
          {Object.entries(current.agents ?? {}).map(([name, agentPolicy]) => (
            <section
              key={name}
              aria-labelledby={`policy-agent-${name}-heading`}
              className="rounded-xl border border-line bg-surface p-5"
            >
              <div className="mb-4 flex items-baseline gap-3">
                <h2 id={`policy-agent-${name}-heading`} className="m-0 text-base font-semibold">
                  <span className="font-mono">{name}</span>
                </h2>
                <span className="text-xs text-muted">overrides the global rules for this agent</span>
                <button
                  type="button"
                  className="ml-auto cursor-pointer rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-danger hover:bg-[#FBEAE6]"
                  onClick={() => {
                    if (confirming) {
                      updateAgent(name, undefined)
                    } else {
                      setConfirming(name)
                    }
                  }}
                >
                  {confirming === name ? 'Confirm remove' : 'Remove override'}
                </button>
              </div>
              <AgentPolicyEditor value={agentPolicy} disabled={false} onChange={(next) => updateAgent(name, next)} />
            </section>
          ))}

          <AddAgentForm onAdd={addAgent} names={Object.keys(current.agents ?? {})} />
        </>
      )}
    </section>
  )
}

function AddAgentForm({ onAdd, names }: { onAdd: (name: string) => void; names: string[] }) {
  const [name, setName] = useState('')
  const taken = names.includes(name.trim())
  const valid = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name.trim()) && !taken
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-line-strong bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onAdd(name)
        setName('')
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-[#30343B]">Add an agent override</span>
        <input
          className="min-h-11 w-64 rounded-lg border border-[#CFCFC8] bg-surface px-3 text-sm text-ink"
          placeholder="agent name (as it identifies itself)"
          value={name}
          aria-invalid={taken ? true : undefined}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button type="submit" className={buttonPrimary} disabled={!valid}>
        Add override
      </button>
      {taken && <span className="text-xs text-danger">An override with this name already exists.</span>}
      {!taken && name.trim() && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name.trim()) && (
        <span className="text-xs text-muted">Letters, digits, dots, underscores and dashes only.</span>
      )}
    </form>
  )
}
