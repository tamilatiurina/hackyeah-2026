import { useState } from 'react'
import { Link } from 'react-router'
import { useCreateGatewayKey, useRevokeGatewayKey } from '../../api/agents'
import type { Agent } from '../../api/types'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { useToast } from '../../ui/toastContext'
import { cardSummary } from '../agents/agentDisplay'
import type { WorkspaceCounts } from './AgentPage'
import { agentPath, gatewayUrls, type Section, type SetupProgress } from './setupProgress'
import { ArrowLink, sectionCard, sectionText, sectionTitle, smallButton, term } from './workspaceUi'
import { copyText } from './workspace'

const KEY_PLACEHOLDER = '$AGENTS_ON_RAILS_KEY'

function curlExample(url: string, key: string): string {
  const body = {
    jsonrpc: '2.0',
    id: '1',
    method: 'SendMessage',
    params: { message: { messageId: 'msg-1', contextId: 'ctx-1', role: 'ROLE_USER', parts: [{ text: 'Hello' }] } },
  }
  const keyArg = key === KEY_PLACEHOLDER ? `"X-API-Key: ${key}"` : `'X-API-Key: ${key}'`
  return [
    `curl -X POST '${url}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H ${keyArg} \\`,
    `  -d '${JSON.stringify(body)}'`,
  ].join('\n')
}

interface AgentDeployProps {
  agent: Agent
  progress: SetupProgress
  counts: WorkspaceCounts
}

/** Setup step 5 (B-01): pre-flight checks and the gateway key that opens the guarded URL; once
 * live, the key, the guarded URL, a first call, and rotating or revoking the key. */
export function AgentDeploy({ agent, progress, counts }: AgentDeployProps) {
  const createKey = useCreateGatewayKey(agent.id)
  const revokeKey = useRevokeGatewayKey(agent.id)
  const toast = useToast()
  const [newKey, setNewKey] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'rotate' | 'offline' | null>(null)
  const urls = gatewayUrls(agent.id)
  const failed = (error: Error) => toast(error.message)

  const issue = (message: string) => {
    setConfirm(null)
    createKey.mutate(undefined, {
      onSuccess: (created) => {
        setNewKey(created.key)
        toast(message)
      },
      onError: failed,
    })
  }

  if (!progress.live) {
    return (
      <Preflight
        agent={agent}
        progress={progress}
        counts={counts}
        pending={createKey.isPending}
        onCreate={() => issue(`${agent.name} is live. Copy the key before you leave this page.`)}
      />
    )
  }

  const curl = curlExample(urls.gateway, newKey ?? KEY_PLACEHOLDER)
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="live-title" className={sectionCard}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <h2 id="live-title" className={sectionTitle}>
                Live
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-teal-soft px-2 py-0.5 text-xs font-semibold text-teal-dark">
                <span className="size-1.5 rounded-full bg-teal" />
                Accepting calls
              </span>
            </div>
            <p className={sectionText}>
              Point callers at the guarded URL.
              {agent.config_version !== undefined && ` Every call runs config v${agent.config_version}.`}
            </p>
          </div>
          <ArrowLink to={agentPath(agent.id, 'activity')}>Watch activity</ArrowLink>
        </div>

        {newKey && (
          <div className="flex flex-col gap-2.5 rounded-[10px] border border-amber/45 bg-warn-bg px-4 py-3.5 text-warn-fg">
            <span className="text-sm font-semibold">Copy the key now. It won't be shown again.</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-[1_1_280px] rounded-lg bg-surface px-3 py-2.5 text-[13px] break-all text-ink">{newKey}</code>
              <button type="button" className={`${buttonPrimary} min-h-10 px-3.5 text-[13px]`} onClick={() => void copyText(newKey, 'Key', toast)}>
                Copy key
              </button>
            </div>
          </div>
        )}

        <dl className="m-0 grid items-center gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(110px,12rem)_minmax(0,1fr)]">
          <dt className={term}>Guarded URL</dt>
          <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2">
            <code className="min-w-0 text-[13px] break-all">{urls.gateway}</code>
            <button type="button" aria-label="Copy guarded URL" className={`${smallButton} min-h-8 text-xs`} onClick={() => void copyText(urls.gateway, 'Guarded URL', toast)}>
              Copy
            </button>
          </dd>
          <dt className={term}>Agent Card</dt>
          <dd className="m-0 min-w-0">
            <code className="text-[13px] break-all">{urls.card}</code>
          </dd>
          <dt className={term}>Gateway key</dt>
          <dd className="m-0 font-mono text-[13px]">
            {newKey ? `${newKey.slice(0, 4)}••••${newKey.slice(-4)}` : '•••• (shown once when created)'}
          </dd>
        </dl>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="first-call" className="m-0 text-[13px] font-semibold">
              First call
            </h3>
            <button type="button" className={`${smallButton} min-h-8 text-xs`} onClick={() => void copyText(curl, 'curl command', toast)}>
              Copy curl
            </button>
          </div>
          <pre aria-labelledby="first-call" className="m-0 overflow-x-auto rounded-[10px] bg-ink px-4 py-3.5 font-mono text-xs leading-5 text-[#e8e8e2]">
            {curl}
          </pre>
        </div>
      </section>

      <section aria-labelledby="key-title" className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-6 py-5">
        <h2 id="key-title" className="m-0 text-base font-semibold">
          Key and availability
        </h2>
        <KeyAction
          title="Rotate key."
          text="Issues a new key. The current one stops working at once."
          confirming={confirm === 'rotate'}
          onAsk={() => setConfirm('rotate')}
          onCancel={() => setConfirm(null)}
          ask="Rotate…"
          confirmLabel={createKey.isPending ? 'Rotating…' : 'Rotate now'}
          confirmClass={`${buttonPrimary} min-h-10 px-3.5 text-[13px]`}
          busy={createKey.isPending}
          onConfirm={() => issue('Key rotated. The old key no longer works.')}
        />
        <KeyAction
          title="Take offline."
          text="Revokes the key. The guarded URL returns 401 until you create a new one."
          confirming={confirm === 'offline'}
          onAsk={() => setConfirm('offline')}
          onCancel={() => setConfirm(null)}
          ask="Take offline…"
          askClass="text-danger hover:bg-[#FBE7E2]"
          confirmLabel={revokeKey.isPending ? 'Revoking…' : 'Revoke key'}
          confirmClass={`${buttonSecondary} min-h-10 border-danger px-3.5 text-[13px] font-semibold text-danger`}
          busy={revokeKey.isPending}
          onConfirm={() =>
            revokeKey.mutate(undefined, {
              onSuccess: () => {
                setConfirm(null)
                setNewKey(null)
                toast(`${agent.name} is offline. The guarded URL now returns 401.`)
              },
              onError: failed,
            })
          }
        />
      </section>
    </div>
  )
}

interface KeyActionProps {
  title: string
  text: string
  ask: string
  askClass?: string
  confirming: boolean
  confirmLabel: string
  confirmClass: string
  busy: boolean
  onAsk: () => void
  onCancel: () => void
  onConfirm: () => void
}

function KeyAction({ title, text, ask, askClass = '', confirming, confirmLabel, confirmClass, busy, onAsk, onCancel, onConfirm }: KeyActionProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5 border-t border-line pt-3">
      <span className="flex-[1_1_300px] text-sm leading-[22px] text-muted">
        <strong className="font-semibold text-ink">{title}</strong> {text}
      </span>
      {confirming ? (
        <span className="flex flex-wrap gap-2">
          <button type="button" className={`${smallButton} min-h-10`} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" autoFocus className={confirmClass} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </span>
      ) : (
        <button type="button" className={`${smallButton} min-h-10 ${askClass}`} onClick={onAsk}>
          {ask}
        </button>
      )}
    </div>
  )
}

interface PreflightProps extends AgentDeployProps {
  pending: boolean
  onCreate: () => void
}

type CheckState = 'ok' | 'warn' | 'skip'

function Preflight({ agent, counts, pending, onCreate }: PreflightProps) {
  const checks: { label: string; state: CheckState; text: string; fix?: { to: Section; label: string } }[] = [
    { label: 'Connection', state: 'ok', text: `Agent Card ${cardSummary(agent.agent_card)}` },
    counts.attached > 0
      ? { label: 'Guardrails', state: 'ok', text: `${counts.mandatory} mandatory · ${counts.attached} attached` }
      : { label: 'Guardrails', state: 'warn', text: 'Only the mandatory checks will run.', fix: { to: 'guardrails', label: 'Attach guardrails' } },
    counts.allowedTools
      ? { label: 'MCP tools', state: 'ok', text: `${counts.allowedTools} tools allowed` }
      : { label: 'MCP tools', state: 'skip', text: 'None. Optional.', fix: { to: 'mcp', label: 'Choose tools' } },
    agent.tested
      ? { label: 'Test', state: 'ok', text: 'Messages ran through the guardrails.' }
      : { label: 'Test', state: 'warn', text: 'Not tested yet.', fix: { to: 'test', label: 'Run a test' } },
  ]
  const warnings = checks.filter((c) => c.state === 'warn').length
  const marks: Record<CheckState, { mark: string; className: string }> = {
    ok: { mark: '✓', className: 'bg-teal-soft text-teal-dark' },
    warn: { mark: '!', className: 'bg-warn-bg text-warn-fg' },
    skip: { mark: '–', className: 'bg-[#F0F0EB] text-muted' },
  }
  return (
    <section aria-labelledby="preflight-title" className={sectionCard}>
      <div className="flex flex-col gap-1">
        <h2 id="preflight-title" className={sectionTitle}>
          Go live
        </h2>
        <p className={sectionText}>
          Creating a gateway key opens the guarded URL to callers. Nothing below blocks you; warnings are worth a look
          first.
        </p>
      </div>
      <ul aria-label="Pre-flight checks" className="m-0 flex list-none flex-col gap-px overflow-hidden rounded-[10px] border border-line bg-line p-0">
        {checks.map((c) => (
          <li key={c.label} className="flex min-h-14 flex-wrap items-center gap-x-3.5 gap-y-2 bg-surface px-3.5 py-2.5">
            <span aria-hidden="true" className={`inline-flex size-[22px] flex-none items-center justify-center rounded-full text-xs font-bold ${marks[c.state].className}`}>
              {marks[c.state].mark}
            </span>
            <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
              <span className="text-sm font-semibold">{c.label}</span>
              <span className={`text-[13px] ${c.state === 'warn' ? 'text-warn-fg' : 'text-muted'}`}>{c.text}</span>
            </span>
            {c.fix && (
              <Link to={agentPath(agent.id, c.fix.to)} className={`${smallButton} no-underline hover:text-ink`}>
                {c.fix.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-muted">
          {warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}. You can go live anyway.` : 'All set.'}
        </span>
        <button type="button" className={buttonPrimary} disabled={pending} onClick={onCreate}>
          {pending ? 'Creating…' : 'Create gateway key'}
        </button>
      </div>
    </section>
  )
}
