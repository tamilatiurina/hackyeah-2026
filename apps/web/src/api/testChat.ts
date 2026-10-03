import { useMutation } from '@tanstack/react-query'
import { readReply, type Reply, type SendMessageRequest, type SendMessageResponse } from './a2a'
import { postJson } from './client'

const enc = encodeURIComponent

/** A random id. crypto.randomUUID only exists in secure contexts (HTTPS, localhost), not over plain
 * HTTP on a LAN address, e.g. `vite --host` at a demo. These ids are not secrets. */
function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** A2A contextId: the hub's session key; one per chat. */
export function newContextId(): string {
  return `ctx-${randomId()}`
}

export function useSendTestMessage(agentId: string) {
  return useMutation({
    mutationFn: async ({ text, contextId }: { text: string; contextId: string }): Promise<Reply> => {
      const messageId = randomId()
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
