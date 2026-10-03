import { describe, expect, it } from 'vitest'
import { readReply, TASK_CANCELED, TASK_FAILED, UNFINISHED_TASK, type SendMessageResponse, type TraceEntry } from './a2a'

const run = (verdict: TraceEntry['verdict'], stage: TraceEntry['stage'] = 'output'): TraceEntry => ({
  guardrailId: `gr-${verdict}`,
  guardrailName: `G ${verdict}`,
  engine: 'regex',
  stage,
  verdict,
  reason: verdict,
  latencyMs: 2,
})

const message = (text: string, trace: TraceEntry[] = [], extra: object = {}): SendMessageResponse => ({
  jsonrpc: '2.0',
  id: 'req-1',
  result: {
    message: {
      messageId: 'm-1',
      contextId: 'ctx-1',
      role: 'ROLE_AGENT',
      parts: [{ text }],
      metadata: { guardrailHub: { trace, ...extra } },
    },
  },
})

describe('readReply', () => {
  it('reads a plain message as passed', () => {
    const reply = readReply(message('Order 1234 shipped yesterday.', [run('pass', 'input')]), 'x')
    expect(reply).toMatchObject({ messageId: 'm-1', text: 'Order 1234 shipped yesterday.', verdict: 'passed' })
    expect(reply.trace).toHaveLength(1)
  })

  it('derives redacted and warned from the trace', () => {
    expect(readReply(message('[EMAIL]', [run('pass'), run('redact')]), 'x').verdict).toBe('redacted')
    expect(readReply(message('hm', [run('warn')]), 'x').verdict).toBe('warned')
    expect(readReply(message('both', [run('warn'), run('redact')]), 'x').verdict).toBe('redacted')
  })

  it('reads the contract’s rejected task as blocked, with its text', () => {
    const response: SendMessageResponse = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        task: {
          id: 'blk-1',
          contextId: 'ctx-42',
          status: {
            state: 'TASK_STATE_REJECTED',
            message: {
              messageId: 'c9d4',
              role: 'ROLE_AGENT',
              parts: [{ text: 'Blocked by guardrail "Prompt injection": ignore-instructions signature matched.' }],
            },
          },
          metadata: { guardrailHub: { blocked: true, stage: 'input', trace: [run('block', 'input')] } },
        },
      },
    }
    const reply = readReply(response, 'x')
    expect(reply.verdict).toBe('blocked')
    expect(reply.messageId).toBe('c9d4')
    expect(reply.text).toContain('Blocked by guardrail')
    expect(reply.trace[0].verdict).toBe('block')
  })

  it('joins artifact text, then the status message, for a finished task', () => {
    const reply = readReply(
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          task: {
            id: 't-1',
            status: { state: 'TASK_STATE_COMPLETED', message: { messageId: 's-1', role: 'ROLE_AGENT', parts: [{ text: 'Done.' }] } },
            artifacts: [{ parts: [{ text: 'Result A' }, { data: { n: 1 } }, { url: 'https://x/f.pdf' }] }],
          },
        },
      },
      'x',
    )
    expect(reply.text).toBe('Result A\n{"n":1}\n[file]\nDone.')
    expect(reply.verdict).toBe('passed')
  })

  it('reads a JSON-RPC error as an error reply', () => {
    const reply = readReply({ jsonrpc: '2.0', id: 'req-1', error: { code: -32603, message: 'Internal error' } }, 'fallback')
    expect(reply).toMatchObject({ messageId: 'fallback', verdict: 'error', errorMessage: 'Agent error -32603: Internal error' })
  })

  it('treats an unfinished task as outside the profile', () => {
    const reply = readReply(
      { jsonrpc: '2.0', id: 1, result: { task: { id: 't', status: { state: 'TASK_STATE_WORKING' } } } },
      'fallback',
    )
    expect(reply).toMatchObject({ verdict: 'error', errorMessage: UNFINISHED_TASK })
  })

  it('reads usage, limits and scores, falling back to the agent’s own usage', () => {
    const withHub = readReply(
      message('x', [], {
        usage: { inputTokens: 3, outputTokens: 4, costUsd: 0.001 },
        limits: [{ name: 'Session tokens', used: 7, max: 100 }],
        scores: [{ name: 'Helpfulness', score: 0.8 }],
      }),
      'x',
    )
    expect(withHub.usage).toEqual({ inputTokens: 3, outputTokens: 4, costUsd: 0.001 })
    expect(withHub.limits).toHaveLength(1)
    expect(withHub.scores).toHaveLength(1)
    const agentOnly = readReply(
      {
        jsonrpc: '2.0',
        id: 1,
        result: { message: { messageId: 'm', role: 'ROLE_AGENT', parts: [{ text: 'hi' }], metadata: { usage: { inputTokens: 1, outputTokens: 2 } } } },
      },
      'x',
    )
    expect(agentOnly.usage).toEqual({ inputTokens: 1, outputTokens: 2 })
    expect(agentOnly.trace).toEqual([])
    expect(agentOnly.limits).toEqual([])
  })

  it('never shows a failed or canceled task as passed', () => {
    const task = (state: 'TASK_STATE_FAILED' | 'TASK_STATE_CANCELED'): SendMessageResponse => ({
      jsonrpc: '2.0',
      id: 1,
      result: {
        task: { id: 't', status: { state, message: { messageId: 's', role: 'ROLE_AGENT', parts: [{ text: 'Could not finish.' }] } } },
      },
    })
    expect(readReply(task('TASK_STATE_FAILED'), 'x')).toMatchObject({
      verdict: 'error',
      text: 'Could not finish.',
      errorMessage: TASK_FAILED,
    })
    expect(readReply(task('TASK_STATE_CANCELED'), 'x')).toMatchObject({ verdict: 'error', errorMessage: TASK_CANCELED })
  })
})
