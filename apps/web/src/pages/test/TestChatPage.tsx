import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import type { Reply, Verdict } from '../../api/a2a'
import { useAgents } from '../../api/agents'
import { newContextId, useSendTestMessage } from '../../api/testChat'
import { badgeClass, buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { EmptyState, LoadingRows, PageHeader, PageShell } from '../../ui/Page'
import { LoadError } from '../ApiUnavailable'
import { FlagReply } from './FlagReply'
import { TracePanel } from './TracePanel'

const CHIPS = ['#pii', '#secret', '#inject', '#toxic', '#offtopic']

const VERDICTS: Record<Verdict, { label: string; className: string }> = {
  passed: { label: 'Passed', className: 'bg-teal-soft text-teal-dark' },
  redacted: { label: 'Redacted', className: 'bg-warn-bg text-warn-fg' },
  warned: { label: 'Warned', className: 'bg-warn-bg text-warn-fg' },
  blocked: { label: 'Blocked', className: 'bg-[#FBE7E2] text-danger' },
  error: { label: 'Error', className: 'bg-[#FBE7E2] text-danger' },
}

interface Turn {
  id: string
  userText: string
  /** The chat this turn belongs to; replies for an older chat are dropped. */
  contextId: string
  status: 'pending' | 'done' | 'failed'
  reply?: Reply
  failure?: string
}

export function TestChatPage() {
  const agents = useAgents()
  const [pickedAgentId, setPickedAgentId] = useState('')
  const agentId = pickedAgentId || agents.data?.[0]?.id || ''
  const [contextId, setContextId] = useState(newContextId)
  const [turns, setTurns] = useState<Turn[]>([])
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [showTrace, setShowTrace] = useState(false)
  const sendMessage = useSendTestMessage(agentId)
  const currentContext = useRef(contextId)
  const turnCounter = useRef(0)
  const conversationRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    currentContext.current = contextId
  }, [contextId])

  useEffect(() => {
    const conversation = conversationRef.current
    if (conversation) conversation.scrollTop = conversation.scrollHeight
  }, [turns])

  const pending = turns.some((t) => t.status === 'pending')
  const canSend = Boolean(agentId) && !pending

  const updateTurn = (id: string, forContext: string, changes: Partial<Turn>) => {
    if (forContext !== currentContext.current) return // a late answer for a chat that was reset
    setTurns((current) => current.map((t) => (t.id === id ? { ...t, ...changes } : t)))
  }

  const send = (message: string, retryOf?: Turn) => {
    const turn: Turn = retryOf
      ? { ...retryOf, status: 'pending', reply: undefined, failure: undefined }
      : { id: `turn-${++turnCounter.current}`, userText: message, contextId, status: 'pending' }
    setTurns((current) => (retryOf ? current.map((t) => (t.id === turn.id ? turn : t)) : [...current, turn]))
    setSelectedTurnId(null)
    sendMessage.mutate(
      { text: message, contextId: turn.contextId },
      {
        onSuccess: (reply) => updateTurn(turn.id, turn.contextId, { status: 'done', reply }),
        onError: (error) => {
          updateTurn(turn.id, turn.contextId, { status: 'failed', failure: error.message })
        },
      },
    )
  }

  const reset = () => {
    const next = newContextId()
    currentContext.current = next
    setContextId(next)
    setTurns([])
    setSelectedTurnId(null)
    setShowTrace(false)
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const message = text.trim()
    if (!message || !canSend) return
    setText('')
    send(message)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  // One live region that stays mounted, so screen readers hear each reply (FR-10/11 accessibility).
  const last = turns[turns.length - 1]
  const liveText = !last
    ? ''
    : last.status === 'pending'
      ? 'Waiting for the agent'
      : `Reply ${turns.length}: ${
          last.status === 'failed' ? VERDICTS.error.label : VERDICTS[last.reply?.verdict ?? 'error'].label
        }. ${[last.reply?.text, last.failure ?? last.reply?.errorMessage].filter(Boolean).join(' ')}`

  const finished = turns.filter((t) => t.reply)
  const selected = turns.find((t) => t.id === selectedTurnId && t.reply) ?? finished[finished.length - 1] ?? null

  return (
    <PageShell>
      <PageHeader title="Test chat" description="Talk to an agent through the hub's guardrails." />

      {agents.isPending ? (
        <LoadingRows label="Loading agents" count={2} />
      ) : agents.isError ? (
        <LoadError what="agents" error={agents.error} onRetry={() => void agents.refetch()} />
      ) : agents.data.length === 0 ? (
        <EmptyState
          title="Register an agent first."
          description="Test chat needs a registered agent."
          action={<Link to="/agents" className="text-sm font-semibold underline decoration-teal/30 underline-offset-4">Go to Agents</Link>}
        />
      ) : (
        <div className="grid min-h-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <section aria-labelledby="chat-setup-heading" className="rounded-xl border border-line bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 id="chat-setup-heading" className="m-0 text-sm font-semibold">Conversation setup</h2>
                  <p className="mt-1 mb-0 text-xs text-muted">Choose the guarded agent used for this chat.</p>
                </div>
                <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
                  <div className="flex min-w-60 flex-1 flex-col gap-1.5 sm:flex-none">
                    <label htmlFor="chat-agent" className="text-[13px] font-semibold text-[#30343B]">
                      Agent
                    </label>
                    <select
                      id="chat-agent"
                      value={agentId}
                      onChange={(e) => {
                        setPickedAgentId(e.target.value)
                        reset()
                      }}
                      className={inputClass}
                    >
                      {agents.data.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className={buttonSecondary} onClick={reset}>
                    New chat
                  </button>
                </div>
              </div>
            </section>

            <ol
              ref={conversationRef}
              aria-label="Conversation"
              className="m-0 flex min-h-64 max-h-[min(34rem,55vh)] list-none flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-surface p-4 overscroll-contain scroll-smooth"
            >
              {turns.length === 0 && (
                <li className="text-sm text-muted">Send a message or pick a scenario below.</li>
              )}
              {turns.map((turn, index) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  number={index + 1}
                  selected={selected?.id === turn.id}
                  onSelect={() => {
                    setSelectedTurnId(turn.id)
                    setShowTrace(true)
                  }}
                  onRetry={() => send(turn.userText, turn)}
                  retryDisabled={!canSend}
                  agentId={agentId}
                />
              ))}
            </ol>

            <p data-testid="chat-live" aria-live="polite" className="sr-only">
              {liveText}
            </p>

            <form onSubmit={submit} className="flex flex-col gap-3">
              <label htmlFor="chat-message" className="text-[13px] font-semibold text-[#30343B]">
                Message
              </label>
              <textarea
                id="chat-message"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask the agent something. Enter sends, Shift+Enter adds a line."
                className={`${inputClass} py-2`}
              />
              <div className="flex flex-wrap items-center gap-2">
                {CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={!canSend}
                    onClick={() => send(chip)}
                    className={`${buttonSecondary} px-3 font-mono text-xs`}
                  >
                    {chip}
                  </button>
                ))}
                <button type="submit" className={`${buttonPrimary} ml-auto`} disabled={!text.trim() || !canSend}>
                  Send
                </button>
              </div>
            </form>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <button
              type="button"
              aria-expanded={showTrace}
              onClick={() => setShowTrace((v) => !v)}
              className={`${buttonSecondary} lg:hidden`}
            >
              {showTrace ? 'Hide trace' : 'Show trace'}
            </button>
            <aside className={`${showTrace ? '' : 'max-lg:hidden'} min-w-0`}>
              <TracePanel reply={selected?.reply ?? null} />
            </aside>
          </div>
        </div>
      )}
    </PageShell>
  )
}

interface TurnViewProps {
  turn: Turn
  number: number
  selected: boolean
  onSelect: () => void
  onRetry: () => void
  retryDisabled: boolean
  agentId: string
}

function TurnView({ turn, number, selected, onSelect, onRetry, retryDisabled, agentId }: TurnViewProps) {
  const reply = turn.reply
  const verdict = turn.status === 'failed' ? VERDICTS.error : reply ? VERDICTS[reply.verdict] : null
  const errorText = turn.failure ?? reply?.errorMessage
  return (
    <>
      <li className="flex justify-end">
        <p className="m-0 max-w-[80%] rounded-xl bg-ink px-3 py-2 text-sm whitespace-pre-wrap text-white">
          {turn.userText}
        </p>
      </li>
      <li className="flex justify-start">
        {turn.status === 'pending' ? (
          <p className="m-0 rounded-xl bg-canvas px-3 py-2 text-sm text-muted">
            <span aria-hidden="true">…</span>
          </p>
        ) : (
          <article
            aria-label={`Reply ${number}`}
            data-selected={selected}
            className={`flex max-w-[80%] flex-col gap-2 rounded-xl border px-3 py-2 ${
              selected ? 'border-teal' : 'border-line'
            } bg-canvas`}
          >
            {reply?.text && <p className="m-0 text-sm whitespace-pre-wrap">{reply.text}</p>}
            {errorText && <p className="m-0 text-sm text-danger">{errorText}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {verdict && <span className={`${badgeClass} ${verdict.className}`}>{verdict.label}</span>}
              {reply && (
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Inspect reply ${number}`}
                  onClick={onSelect}
                  className={`${buttonSecondary} px-3 text-xs`}
                >
                  Inspect
                </button>
              )}
              {reply && reply.verdict !== 'error' && (
                <FlagReply
                  agentId={agentId}
                  contextId={turn.contextId}
                  messageId={reply.messageId}
                  label={`Flag reply ${number}`}
                />
              )}
              {errorText && (
                <button type="button" disabled={retryDisabled} onClick={onRetry} className={`${buttonSecondary} px-3 text-xs`}>
                  Retry
                </button>
              )}
            </div>
          </article>
        )}
      </li>
    </>
  )
}
