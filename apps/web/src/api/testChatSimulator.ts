// Stand-in for B-06 (#46) until the API has POST /agents/{id}/test-chat: imitates the guarded
// gateway in front of apps/test-agent, whose triggers start the message. It answers in exactly the
// shape B-06 will, so the page's parser, badges and trace don't change. Delete it once B-06 ships.
// The test suite's fake API uses it too.
import type { SendMessageRequest, SendMessageResponse, TraceEntry } from './a2a'

interface SimulateOptions {
  /** Makes ids unique within a run. */
  serial: number
  /** Mark every trace entry simulated (the browser fallback); the test fake leaves real ones unmarked. */
  markSimulated?: boolean
}

export function simulateTestChat(
  request: SendMessageRequest,
  { serial, markSimulated = false }: SimulateOptions,
): SendMessageResponse {
  const trace = (
    name: string,
    stage: TraceEntry['stage'],
    verdict: TraceEntry['verdict'],
    reason: string,
    engine: TraceEntry['engine'] = 'regex',
    simulated = false,
  ): TraceEntry => ({
    guardrailId: `gr-${name.toLowerCase().replace(/\W+/g, '-')}`,
    guardrailName: name,
    engine,
    stage,
    verdict,
    reason,
    latencyMs: 3,
    ...(simulated || markSimulated ? { simulated: true } : {}),
  })
  const injectionPass = trace('Prompt injection detector', 'input', 'pass', 'No match')

  const { message } = request.params
  const text = message.parts.map((p) => ('text' in p ? p.text : '')).join('\n')
  const contextId = message.contextId ?? 'ctx-new'
  const usage = { inputTokens: text.split(/\s+/).length, outputTokens: 12, costUsd: 0.0002 }
  const limits = [{ name: 'Session tokens', used: 24, max: 16000 }]
  const reply = (replyText: string, runs: TraceEntry[]): SendMessageResponse => ({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      message: {
        messageId: `agent-${serial}`,
        contextId,
        role: 'ROLE_AGENT',
        parts: [{ text: replyText }],
        metadata: { guardrailHub: { trace: runs, usage, limits } },
      },
    },
  })
  const blocked = (stage: 'input' | 'output', runs: TraceEntry[], why: string): SendMessageResponse => ({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      task: {
        id: `blk-${serial}`,
        contextId,
        status: {
          state: 'TASK_STATE_REJECTED',
          message: { messageId: `agent-${serial}`, role: 'ROLE_AGENT', parts: [{ text: why }] },
        },
        metadata: { guardrailHub: { blocked: true, stage, trace: runs, usage, limits } },
      },
    },
  })
  switch (text.trim().split(/\s+/)[0]) {
    case '#pii':
      return reply('Reach me at [EMAIL] or [PHONE].', [
        injectionPass,
        trace('PII redaction', 'output', 'redact', 'Found EMAIL, PHONE', 'library'),
      ])
    case '#secret':
      return reply('Use key [REDACTED].', [injectionPass, trace('Secret keys', 'output', 'redact', 'Matched /AKIA[0-9A-Z]{16}/')])
    case '#inject':
      return blocked(
        'input',
        [trace('Prompt injection detector', 'input', 'block', 'Matched injection signature: ignore-instructions')],
        'Blocked by guardrail "Prompt injection detector": ignore-instructions signature matched.',
      )
    case '#toxic':
      return blocked(
        'output',
        [injectionPass, trace('Toxicity filter', 'output', 'block', 'Simulated: Abusive language: idiot', 'moderation', true)],
        'Blocked by guardrail "Toxicity filter".',
      )
    case '#offtopic':
      return reply("Let's talk about elections and crypto.", [
        injectionPass,
        trace('Topic: orders and returns only', 'output', 'warn', 'Simulated: Mentions a denied topic: crypto', 'llm_judge', true),
      ])
    case '#error':
      return { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Internal error' } }
    default:
      return reply(`You said: ${text}`, [injectionPass])
  }
}
