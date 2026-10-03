import { useMutation } from '@tanstack/react-query'
import { readReply, type Reply, type SendMessageRequest, type SendMessageResponse } from './a2a'
import { postJson } from './client'

const enc = encodeURIComponent

/** A2A contextId: the hub's session key; one per chat. */
export function newContextId(): string {
  return `ctx-${crypto.randomUUID()}`
}

export function useSendTestMessage(agentId: string) {
  return useMutation({
    mutationFn: async ({ text, contextId }: { text: string; contextId: string }): Promise<Reply> => {
      const messageId = crypto.randomUUID()
      const request: SendMessageRequest = {
        jsonrpc: '2.0',
        id: `req-${messageId}`,
        method: 'SendMessage',
        params: { message: { messageId, contextId, role: 'ROLE_USER', parts: [{ text }] } },
      }
      const response = await postJson<SendMessageResponse>(`/agents/${enc(agentId)}/test-chat`, request)
      return readReply(response, `err-${messageId}`)
    },
  })
}

export function useFlagReply(agentId: string) {
  return useMutation({
    mutationFn: (flag: { contextId: string; messageId: string; comment: string }) =>
      postJson<unknown>(`/agents/${enc(agentId)}/flags`, flag),
  })
}
