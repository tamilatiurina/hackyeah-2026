import { useRef, useState } from 'react'
import type { Reply } from '../../api/a2a'
import { useMarkTested } from '../../api/agents'
import { newContextId, useSendTestMessage } from '../../api/testChat'

export interface ChatTurn {
  id: string
  text: string
  /** Set when the turn came from a scenario button. */
  scenarioId?: string
  status: 'pending' | 'done' | 'failed'
  reply?: Reply
  failure?: string
}

/** One test chat per agent: a contextId and its turns. The workspace owns it, so the conversation
 * survives moving between sections. */
export function useAgentTestChat(agentId: string) {
  const [contextId, setContextId] = useState(newContextId)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const sendMessage = useSendTestMessage(agentId)
  const markTested = useMarkTested(agentId)
  const currentContext = useRef(contextId)
  const counter = useRef(0)

  const update = (id: string, forContext: string, changes: Partial<ChatTurn>) => {
    if (forContext !== currentContext.current) return // a late answer for a chat that was reset
    setTurns((current) => current.map((t) => (t.id === id ? { ...t, ...changes } : t)))
  }

  const send = (text: string, scenarioId?: string) => {
    const forContext = currentContext.current
    const turn: ChatTurn = { id: `turn-${++counter.current}`, text, scenarioId, status: 'pending' }
    setTurns((current) => [...current, turn])
    sendMessage.mutate(
      { text, contextId: forContext },
      {
        onSuccess: (reply) => {
          update(turn.id, forContext, { status: 'done', reply })
          markTested()
        },
        onError: (error) => update(turn.id, forContext, { status: 'failed', failure: error.message }),
      },
    )
  }

  const reset = () => {
    const next = newContextId()
    currentContext.current = next
    setContextId(next)
    setTurns([])
  }

  return { contextId, turns, send, reset, pending: turns.some((t) => t.status === 'pending') }
}

export type AgentTestChat = ReturnType<typeof useAgentTestChat>
