import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAgents, useGroups } from '../../api/agents'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { AgentsTable, AgentsTableSkeleton } from './AgentsTable'
import { GroupChips } from './GroupChips'
import { RegisterAgentForm } from './RegisterAgentForm'

export function AgentsPage() {
  const agents = useAgents()
  const groups = useGroups()
  const [searchParams, setSearchParams] = useSearchParams()
  const [registering, setRegistering] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const registerButtonRef = useRef<HTMLButtonElement>(null)
  const wasRegistering = useRef(false)

  // Give focus back to "Register agent" when the form closes (Cancel, Done or success).
  useEffect(() => {
    if (wasRegistering.current && !registering) registerButtonRef.current?.focus()
    wasRegistering.current = registering
  }, [registering])

  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => setHighlightId(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightId])

  const groupList = groups.data ?? []
  const requested = searchParams.get('group')
  const selectedGroupId = groupList.some((g) => g.id === requested) ? requested : null
  const selectGroup = (groupId: string | null) =>
    setSearchParams(groupId ? { group: groupId } : {}, { replace: true })
  const groupName = (groupId: string) => groupList.find((g) => g.id === groupId)?.name ?? groupId
  // Registering needs the group list, and adding to an unloaded agents cache would hide the rest.
  const loaded = agents.isSuccess && groups.isSuccess
  const rows = (agents.data ?? []).filter((a) => !selectedGroupId || a.groupId === selectedGroupId)

  let content
  if (agents.isError || groups.isError) {
    content = (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-6">
        <span className="text-sm">Couldn't load agents.</span>
        <button
          type="button"
          className={buttonSecondary}
          onClick={() => {
            void agents.refetch()
            void groups.refetch()
          }}
        >
          Retry
        </button>
      </div>
    )
  } else if (agents.isPending || groups.isPending) {
    content = <AgentsTableSkeleton />
  } else if (rows.length === 0) {
    content = (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        No agents in this group yet
      </div>
    )
  } else {
    content = <AgentsTable agents={rows} groupName={groupName} highlightId={highlightId} />
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Agents</h1>
          <p className="m-0 text-[15px] text-muted">
            Proxy agents sit behind a guarded URL. Runtime agents run on pi and enforce the policy themselves.
          </p>
        </div>
        {loaded && !registering && (
          <button
            ref={registerButtonRef}
            type="button"
            className={buttonPrimary}
            onClick={() => setRegistering(true)}
          >
            Register agent
          </button>
        )}
      </header>
      {registering && (
        <RegisterAgentForm
          groups={groupList}
          defaultGroupId={selectedGroupId ?? groupList[0]?.id ?? ''}
          onClose={() => setRegistering(false)}
          onRegistered={(agent) => {
            setHighlightId(agent.id)
            // Keep the new row in view when it lands outside the current filter.
            if (selectedGroupId && agent.groupId !== selectedGroupId) selectGroup(agent.groupId)
          }}
        />
      )}
      <GroupChips groups={groupList} selectedId={selectedGroupId} onSelect={selectGroup} />
      {content}
    </section>
  )
}
