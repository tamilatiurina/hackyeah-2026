import { Link } from 'react-router'
import { useAuditEvents, useSessions } from '../../api/audit'
import { useEffectiveGuardrails } from '../../api/bindings'
import type { Agent } from '../../api/types'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { formatRelative, shortId } from '../../ui/format'
import { useToast } from '../../ui/toastContext'
import { cardSummary } from '../agents/agentDisplay'
import type { WorkspaceCounts } from './AgentPage'
import { GuardrailFlow } from './GuardrailFlow'
import {
  SETUP_STEPS,
  STEP_CTA,
  agentPath,
  gatewayUrls,
  type SetupProgress,
  type SetupStep,
} from './setupProgress'
import { ActionBadge, ArrowLink, ChevronRight, StepGlyph, sectionCard, sectionText, sectionTitle, smallButton } from './workspaceUi'
import { copyText, eventKind } from './workspace'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const TITLES: Record<SetupStep, string> = {
  connection: 'Connect the agent',
  guardrails: 'Attach guardrails',
  mcp: 'Choose MCP tools',
  test: 'Test the guarded pipeline',
  deploy: 'Go live',
}

const EVENT_LABELS = { block: 'Blocked', redact: 'Redacted', warn: 'Warned', limit: 'Limit' } as const

interface AgentOverviewProps {
  agent: Agent
  progress: SetupProgress
  counts: WorkspaceCounts
}

/** The workspace's landing section: the setup checklist, or once live the guarded URL and recent
 * activity; always the order the guardrails run in. */
export function AgentOverview({ agent, progress, counts }: AgentOverviewProps) {
  const effective = useEffectiveGuardrails(agent.id)
  return (
    <div className="flex flex-col gap-6">
      {progress.live ? <LiveSummary agent={agent} /> : <Checklist agent={agent} progress={progress} counts={counts} />}

      <section aria-labelledby="overview-order" className={sectionCard}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="overview-order" className={sectionTitle}>
              Runs in this order
            </h2>
            <p className={sectionText}>Mandatory checks run first. Redacted text feeds the next check.</p>
          </div>
          <Link to={agentPath(agent.id, 'guardrails')} className={`${smallButton} no-underline`}>
            Edit guardrails
          </Link>
        </div>
        {effective.isPending ? (
          <p className="m-0 text-sm text-muted">Loading guardrails…</p>
        ) : effective.isError ? (
          <p role="alert" className="m-0 text-sm text-danger">
            Couldn't load this agent's guardrails.
          </p>
        ) : (
          <GuardrailFlow agentName={agent.name} input={effective.data.input} output={effective.data.output} />
        )}
      </section>
    </div>
  )
}

function Checklist({ agent, progress, counts }: AgentOverviewProps) {
  const descriptions: Record<SetupStep, string> = {
    connection: `Agent Card ${cardSummary(agent.agent_card)} read from ${agent.base_url}`,
    guardrails: counts.attached
      ? `${plural(counts.attached, 'guardrail')} attached, running after ${counts.mandatory} mandatory`
      : progress.done.guardrails
        ? 'Mandatory only. Nothing attached to this agent.'
        : 'Choose checks from the library. The mandatory ones already run.',
    mcp: counts.mcpServers
      ? `${plural(counts.mcpServers, 'server')}, ${plural(counts.allowedTools, 'tool')} allowed`
      : progress.done.mcp
        ? 'Skipped. The agent runs without tools.'
        : 'Grant tool servers and pick which tools the agent may call.',
    test: agent.tested
      ? 'Sent through the guarded pipeline and checked the trace.'
      : 'Send scenarios through the guarded pipeline and read the per-rule trace.',
    deploy: 'Create a gateway key and switch callers to the guarded URL.',
  }
  return (
    <section aria-labelledby="checklist-title" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
        <div className="flex flex-col gap-1">
          <h2 id="checklist-title" className={sectionTitle}>
            Get {agent.name} ready for callers
          </h2>
          <p className="m-0 text-sm text-muted">Work top to bottom, or open any step. Nothing here is locked.</p>
        </div>
        <span className="text-[13px] font-semibold text-muted">
          {progress.doneCount} of {SETUP_STEPS.length} done
        </span>
      </div>
      <ol className="m-0 list-none p-0">
        {SETUP_STEPS.map((step, index) => {
          const done = progress.done[step]
          const isNext = progress.next === step
          return (
            <li
              key={step}
              className={`flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line px-6 py-4 ${isNext ? 'bg-[#F5FAF8]' : ''}`}
            >
              <StepGlyph state={done ? 'done' : isNext ? 'next' : 'todo'} n={index + 1} size={26} />
              <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {TITLES[step]}
                  {step === 'mcp' && !done && (
                    <span className="rounded-md bg-[#F0F0EB] px-2 py-px text-[11px] text-[#30343B]">Optional</span>
                  )}
                  {isNext && <span className="rounded-md bg-teal-soft px-2 py-px text-[11px] text-teal-dark">Next</span>}
                </span>
                <span className="text-[13px] leading-5 break-words text-muted">{descriptions[step]}</span>
              </div>
              <Link
                to={agentPath(agent.id, step)}
                className={`${isNext ? buttonPrimary : buttonSecondary} min-h-10 px-3.5 text-[13px] no-underline ${
                  isNext ? 'hover:text-white' : 'hover:text-ink'
                }`}
              >
                {isNext ? STEP_CTA[step] : done ? 'Review' : 'Open'}
                {isNext && <ChevronRight />}
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function LiveSummary({ agent }: { agent: Agent }) {
  const toast = useToast()
  const sessions = useSessions({ agent_id: agent.id })
  const events = useAuditEvents({ agent_id: agent.id })
  const sessionList = sessions.data?.pages.flatMap((p) => p.data) ?? []
  const eventList = events.data?.pages.flatMap((p) => p.data) ?? []
  const count = (action: string) => eventList.filter((e) => e.kind === 'guardrail' && e.action === action).length
  const stats = [
    { label: 'Sessions', value: sessionList.length },
    { label: 'Blocked', value: count('block') },
    { label: 'Redacted', value: count('redact') },
    { label: 'Warned', value: count('warn') },
  ]
  const url = gatewayUrls(agent.id).gateway
  return (
    <>
      <section aria-label="Guarded URL" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-6 py-5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-[0.04em] text-muted uppercase">Guarded URL</span>
          <code className="block overflow-x-auto rounded-md bg-canvas px-2.5 py-1.5 text-[13px] whitespace-nowrap">{url}</code>
          <span className="text-[13px] text-muted">
            Callers send a gateway key in the <code className="text-xs">X-API-Key</code> header.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary} onClick={() => void copyText(url, 'Guarded URL', toast)}>
            Copy
          </button>
          <Link to={agentPath(agent.id, 'deploy')} className={`${buttonSecondary} no-underline hover:text-ink`}>
            Manage keys
          </Link>
        </div>
      </section>

      <section aria-labelledby="overview-activity" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-4">
          <h2 id="overview-activity" className={sectionTitle}>
            Recent activity
          </h2>
          <ArrowLink to={agentPath(agent.id, 'activity')}>All activity</ArrowLink>
        </div>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] border-t border-line">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5 border-r border-line px-6 py-4 last:border-r-0">
              <dt className="text-xs font-semibold tracking-[0.04em] text-muted uppercase">{s.label}</dt>
              <dd className="m-0 text-2xl font-semibold tracking-[-0.02em]">{s.value}</dd>
            </div>
          ))}
        </dl>
        {eventList.length === 0 ? (
          <p className="m-0 border-t border-line px-6 py-4 text-sm text-muted">No blocks, redactions or warnings yet.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {eventList.slice(0, 3).map((e) => {
              const kind = eventKind(e)
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line px-6 py-3 text-[13px]">
                  <span className="w-[76px] text-muted">{formatRelative(e.at)}</span>
                  <ActionBadge action={kind}>{EVENT_LABELS[kind]}</ActionBadge>
                  <span className="font-semibold">{e.rule_name}</span>
                  <span className="min-w-0 flex-[1_1_200px] text-muted">{e.details}</span>
                  {e.context_id && (
                    <code className="text-xs text-muted" title={e.context_id}>
                      {shortId(e.context_id)}
                    </code>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
