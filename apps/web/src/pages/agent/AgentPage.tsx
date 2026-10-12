import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useCompleteSetupStep, useAgent } from '../../api/agents'
import { useAgentMcpServers } from '../../api/agentMcpServers'
import { useAgentBindings } from '../../api/bindings'
import { ApiError } from '../../api/client'
import { useGuardrails } from '../../api/guardrails'
import type { Agent, ReviewableStep } from '../../api/types'
import { buttonPrimary, buttonSecondary, pillClass } from '../../ui/classes'
import { LoadingRows, PageHeader, PageShell } from '../../ui/Page'
import { useToast } from '../../ui/toastContext'
import { cardSummary } from '../agents/agentDisplay'
import { AgentActivity } from './AgentActivity'
import { AgentConnection } from './AgentConnection'
import { AgentDeploy } from './AgentDeploy'
import { AgentGuardrails } from './AgentGuardrails'
import { AgentMcpServers } from './AgentMcpServers'
import { AgentOverview } from './AgentOverview'
import { AgentTest } from './AgentTest'
import {
  SETUP_STEPS,
  STEP_CTA,
  STEP_LABEL,
  agentPath,
  gatewayUrls,
  isSection,
  setupProgress,
  type Section,
  type SetupProgress,
  type SetupStep,
} from './setupProgress'
import { useAgentTestChat } from './useAgentTestChat'
import { ChevronRight, StepGlyph, type StepState } from './workspaceUi'
import { copyText } from './workspace'

const backLink = 'inline-flex min-h-11 items-center text-sm font-semibold no-underline'

function BackToAgents() {
  return (
    <Link to="/agents" className={`${backLink} -mb-4 self-start`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mr-1.5 h-4 w-4" fill="none">
        <path d="m9.5 3.5-4.5 4.5 4.5 4.5M5 8h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Agents
    </Link>
  )
}

/** /agents/:agentId/:section? — one agent's workspace: its guided setup, then its activity. */
export function AgentPage() {
  const { agentId = '', section } = useParams()
  const agent = useAgent(agentId)

  if (section !== undefined && (!isSection(section) || section === 'overview')) {
    return <Navigate to={agentPath(agentId)} replace />
  }

  if (agent.isPending) {
    return (
      <PageShell>
        <PageHeader title="Loading agent…" />
        <div aria-busy="true">
          <LoadingRows label="Loading agent details" count={3} />
        </div>
      </PageShell>
    )
  }

  if (agent.isError) {
    const notFound = agent.error instanceof ApiError && (agent.error.status === 404 || agent.error.status === 422)
    return notFound ? (
      <PageShell>
        <PageHeader
          title="Agent not found"
          actions={
            <Link to="/agents" className={backLink}>
              Back to agents
            </Link>
          }
        />
      </PageShell>
    ) : (
      <PageShell>
        <PageHeader title="Agent details" />
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 sm:p-6">
          <span className="text-sm">Couldn't load this agent.</span>
          <button type="button" className={buttonSecondary} onClick={() => void agent.refetch()}>
            Retry
          </button>
        </div>
      </PageShell>
    )
  }

  return <AgentWorkspace agent={agent.data} section={section ?? 'overview'} />
}

export interface WorkspaceCounts {
  /** Enabled, non-mandatory guardrails attached to the agent. */
  attached: number
  mandatory: number
  mcpServers: number
  allowedTools: number
}

function AgentWorkspace({ agent, section }: { agent: Agent; section: Section }) {
  const navigate = useNavigate()
  const toast = useToast()
  const guardrails = useGuardrails()
  const bindings = useAgentBindings(agent.id)
  const mcp = useAgentMcpServers(agent.id)
  const completeStep = useCompleteSetupStep(agent.id)
  const chat = useAgentTestChat(agent.id)

  const mandatoryIds = new Set((guardrails.data ?? []).filter((g) => g.is_mandatory).map((g) => g.id))
  const counts: WorkspaceCounts = {
    attached: (bindings.data ?? []).filter((b) => b.enabled && !mandatoryIds.has(b.guardrail_id)).length,
    mandatory: mandatoryIds.size,
    mcpServers: mcp.data?.length ?? 0,
    allowedTools: (mcp.data ?? []).reduce((n, entry) => n + entry.allowed_tools.length, 0),
  }
  const progress = setupProgress(agent, { attached: counts.attached, mcpServers: counts.mcpServers })
  const go = (to: Section) => navigate(agentPath(agent.id, to))

  /** Finishes a reviewable step on the server (once), then opens `to`. */
  const completeAndGo = (step: ReviewableStep, to: Section) => {
    const reviewed = step === 'guardrails' ? agent.guardrails_reviewed : agent.mcp_reviewed
    if (reviewed) {
      go(to)
      return
    }
    completeStep.mutate(step, {
      onSuccess: () => go(to),
      onError: (error) => toast(`Couldn't save your progress: ${error.message}`),
    })
  }

  const footer = progress.live ? null : nextStepFooter(section, agent, progress, counts, go, completeAndGo)

  let content: ReactNode
  switch (section) {
    case 'overview':
      content = <AgentOverview agent={agent} progress={progress} counts={counts} />
      break
    case 'connection':
      content = <AgentConnection agent={agent} />
      break
    case 'guardrails':
      content = <AgentGuardrails agent={agent} />
      break
    case 'mcp':
      content = <AgentMcpServers agent={agent} />
      break
    case 'test':
      content = <AgentTest agent={agent} chat={chat} />
      break
    case 'deploy':
      content = <AgentDeploy agent={agent} progress={progress} counts={counts} />
      break
    case 'activity':
      content = <AgentActivity agent={agent} live={progress.live} />
      break
  }

  const showNext = !progress.live && progress.next !== null && section !== progress.next && !footer
  return (
    <PageShell className="gap-6">
      <BackToAgents />
      <PageHeader
        title={agent.name}
        badge={<StatusPill progress={progress} />}
        description={agent.description || undefined}
        meta={
          <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <code className="text-xs break-all">{agent.base_url}</code>
            <span>Agent Card {cardSummary(agent.agent_card)}</span>
            {agent.config_version !== undefined && <span>Config v{agent.config_version}</span>}
          </span>
        }
        actions={
          <>
            {showNext && progress.next && (
              <Link to={agentPath(agent.id, progress.next)} className={`${buttonPrimary} no-underline hover:text-white`}>
                Next: {STEP_CTA[progress.next]}
                <ChevronRight size={14} />
              </Link>
            )}
            {progress.live && (
              <button
                type="button"
                className={buttonSecondary}
                onClick={() => void copyText(gatewayUrls(agent.id).gateway, 'Guarded URL', toast)}
              >
                Copy guarded URL
              </button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-start gap-8">
        <WorkspaceNav agent={agent} section={section} progress={progress} counts={counts} />
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-6">
          {content}
          {footer}
        </div>
      </div>
    </PageShell>
  )
}

export function StatusPill({ progress }: { progress: SetupProgress }) {
  return (
    <span className={`${pillClass} ${progress.live ? 'bg-teal-soft text-teal-dark' : 'bg-warn-bg text-warn-fg'} tracking-normal`}>
      {progress.statusLabel}
    </span>
  )
}

function stepState(progress: SetupProgress, step: SetupStep): StepState {
  if (progress.done[step]) return 'done'
  return progress.next === step ? 'next' : 'todo'
}

const NAV_ICONS = {
  overview: 'M4 5h7v6H4zM13 5h7v3h-7zM13 10h7v9h-7zM4 13h7v6H4z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
}

interface WorkspaceNavProps {
  agent: Agent
  section: Section
  progress: SetupProgress
  counts: WorkspaceCounts
}

function WorkspaceNav({ agent, section, progress, counts }: WorkspaceNavProps) {
  const tags: Partial<Record<SetupStep, string>> = {
    guardrails: counts.attached ? String(counts.attached + counts.mandatory) : '',
    mcp: progress.done.mcp ? (counts.mcpServers ? String(counts.mcpServers) : 'Skipped') : 'Optional',
  }
  const heading = 'mt-4 mb-1.5 flex items-center justify-between px-2.5 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase'
  const item = (key: Section, label: string, glyph: ReactNode, tag = '') => {
    const on = key === section
    return (
      <Link
        key={key}
        to={agentPath(agent.id, key)}
        aria-current={on ? 'page' : undefined}
        className={`flex min-h-[42px] items-center gap-2.5 rounded-lg border px-2.5 text-sm no-underline ${
          on
            ? 'border-line bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(23,25,30,.04)] hover:text-ink'
            : 'border-transparent font-medium text-[#30343B] hover:bg-[#ebebe6] hover:text-ink'
        }`}
      >
        {glyph}
        <span className="min-w-0 flex-1">{label}</span>
        {tag && <span className="text-[11px] font-medium text-muted">{tag}</span>}
      </Link>
    )
  }
  const icon = (d: string) => (
    <span className="flex size-5 shrink-0 items-center justify-center text-muted">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </span>
  )
  return (
    <nav aria-label="Agent sections" className="flex min-w-[180px] flex-[0_1_200px] flex-col gap-0.5 md:sticky md:top-6">
      {item('overview', 'Overview', icon(NAV_ICONS.overview))}
      <span className={heading}>
        {progress.live ? 'Configure' : 'Setup'}
        {!progress.live && (
          <span className="font-medium tracking-normal normal-case">
            {progress.doneCount} of {SETUP_STEPS.length}
          </span>
        )}
      </span>
      {SETUP_STEPS.map((step, index) =>
        item(
          step,
          step === 'deploy' && progress.live ? 'Deploy' : STEP_LABEL[step],
          <StepGlyph state={stepState(progress, step)} n={index + 1} />,
          tags[step],
        ),
      )}
      <span className={heading}>Operate</span>
      {item('activity', 'Activity', icon(NAV_ICONS.activity))}
    </nav>
  )
}

interface Footer {
  text: string
  primary: string
  onPrimary: () => void
  secondary?: string
  onSecondary?: () => void
}

function nextStepFooter(
  section: Section,
  agent: Agent,
  progress: SetupProgress,
  counts: WorkspaceCounts,
  go: (to: Section) => void,
  completeAndGo: (step: ReviewableStep, to: Section) => void,
): ReactNode {
  let footer: Footer | null = null
  if (section === 'overview' && progress.next) {
    const next = progress.next
    footer = { text: `Next: ${STEP_LABEL[next]}.`, primary: STEP_CTA[next], onPrimary: () => go(next) }
  } else if (section === 'connection') {
    footer = {
      text: `Agent Card ${cardSummary(agent.agent_card)}. Next, choose the checks that run around it.`,
      primary: 'Continue to Guardrails',
      onPrimary: () => go('guardrails'),
    }
  } else if (section === 'guardrails') {
    footer = {
      text: counts.attached
        ? `${counts.attached} attached ${counts.attached === 1 ? 'guardrail runs' : 'guardrails run'} after the mandatory ones.`
        : 'Nothing attached yet. Only the mandatory guardrails will run.',
      primary: 'Continue to MCP tools',
      onPrimary: () => completeAndGo('guardrails', 'mcp'),
    }
  } else if (section === 'mcp') {
    footer = {
      text: 'Optional. The agent runs without tools if you skip this.',
      secondary: 'Skip for now',
      onSecondary: () => completeAndGo('mcp', 'test'),
      primary: 'Continue to Test',
      onPrimary: () => completeAndGo('mcp', 'test'),
    }
  } else if (section === 'test') {
    footer = {
      text: agent.tested
        ? 'Tested. The trace shows what each guardrail did.'
        : 'Send a message or a scenario to see the guardrails run.',
      primary: 'Continue to Go live',
      onPrimary: () => go('deploy'),
    }
  }
  if (!footer) return null

  return (
    <div
      role="region"
      aria-label="Next step"
      className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-xl border border-line bg-white/95 py-3 pr-3 pl-5 shadow-[0_10px_30px_rgba(23,25,30,.10)]"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1" aria-hidden="true">
            {SETUP_STEPS.map((step) => {
              const state = stepState(progress, step)
              return (
                <span
                  key={step}
                  className={`h-1 w-[22px] rounded-full ${
                    state === 'done' ? 'bg-teal' : state === 'next' ? 'bg-teal-bright' : 'bg-line'
                  }`}
                />
              )
            })}
          </div>
          <span className="text-xs font-semibold text-muted">
            Setup {progress.doneCount} of {SETUP_STEPS.length}
          </span>
        </div>
        <span className="text-[13px] leading-5">{footer.text}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {footer.secondary && (
          <button type="button" className={buttonSecondary} onClick={footer.onSecondary}>
            {footer.secondary}
          </button>
        )}
        <button type="button" className={buttonPrimary} onClick={footer.onPrimary}>
          {footer.primary}
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
