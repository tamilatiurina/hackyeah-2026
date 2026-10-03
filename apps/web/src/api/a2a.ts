// The A2A 1.0 subset the hub uses (docs/agent-contract-a2a.md); JSON uses the proto's camelCase names.

export type A2APart =
  | { text: string; metadata?: Record<string, unknown> }
  | { data: unknown; metadata?: Record<string, unknown> }
  | { url: string; mediaType?: string }
  | { raw: string; mediaType?: string }

export interface TraceEntry {
  guardrailId: string
  guardrailName: string
  engine: 'regex' | 'llm_judge' | 'library' | 'moderation'
  stage: 'input' | 'output'
  verdict: 'pass' | 'block' | 'redact' | 'warn' | 'skipped' | 'error'
  reason: string
  latencyMs: number
  simulated?: boolean
}

export interface GuardrailHubMetadata {
  blocked?: boolean
  stage?: 'input' | 'output'
  policyVersion?: string
  role?: string
  userId?: string
  trace?: TraceEntry[]
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
  limits?: { name: string; used: number; max: number; unit?: string }[]
  scores?: { name: string; score: number }[]
}

export interface A2AMetadata {
  guardrailHub?: GuardrailHubMetadata
  usage?: { inputTokens: number; outputTokens: number }
  [key: string]: unknown
}

export interface A2AMessage {
  messageId: string
  contextId?: string
  role: 'ROLE_USER' | 'ROLE_AGENT'
  parts: A2APart[]
  metadata?: A2AMetadata
}

export type TaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_AUTH_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_REJECTED'

export interface A2ATask {
  id: string
  contextId?: string
  status: { state: TaskState; message?: A2AMessage }
  artifacts?: { artifactId?: string; parts: A2APart[] }[]
  metadata?: A2AMetadata
}

type JsonRpcId = string | number | null

export interface SendMessageRequest {
  jsonrpc: '2.0'
  id: string
  method: 'SendMessage'
  params: { message: A2AMessage }
}

export type SendMessageResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: { message: A2AMessage } | { task: A2ATask } }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string; data?: unknown } }

export type Verdict = 'passed' | 'redacted' | 'warned' | 'blocked' | 'error'

export interface Reply {
  messageId: string
  text: string
  verdict: Verdict
  trace: TraceEntry[]
  usage?: GuardrailHubMetadata['usage']
  limits: NonNullable<GuardrailHubMetadata['limits']>
  scores: NonNullable<GuardrailHubMetadata['scores']>
  errorMessage?: string
}

export const UNFINISHED_TASK = "The agent answered with an unfinished task (outside the hub's A2A profile)."
export const TASK_FAILED = 'The agent reported that the task failed.'
export const TASK_CANCELED = 'The agent canceled the task.'

const TERMINAL: ReadonlySet<TaskState> = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
])

function partText(part: A2APart): string {
  if ('text' in part) return part.text
  if ('data' in part) return JSON.stringify(part.data)
  return '[file]' // url / raw parts pass through unchecked (contract §4)
}

const joinParts = (parts: A2APart[]) => parts.map(partText).join('\n')

function errorReply(messageId: string, errorMessage: string): Reply {
  return { messageId, text: '', verdict: 'error', trace: [], limits: [], scores: [], errorMessage }
}

function fromHub(messageId: string, text: string, metadata: A2AMetadata | undefined): Reply {
  const hub = metadata?.guardrailHub ?? {}
  const trace = hub.trace ?? []
  const has = (v: TraceEntry['verdict']) => trace.some((t) => t.verdict === v)
  const verdict: Verdict =
    hub.blocked || has('block') ? 'blocked' : has('redact') ? 'redacted' : has('warn') ? 'warned' : 'passed'
  return {
    messageId,
    text,
    verdict,
    trace,
    usage: hub.usage ?? metadata?.usage,
    limits: hub.limits ?? [],
    scores: hub.scores ?? [],
  }
}

/** Turns the hub's JSON-RPC answer into what the chat shows. */
export function readReply(response: SendMessageResponse, fallbackId: string): Reply {
  if ('error' in response) {
    return errorReply(fallbackId, `Agent error ${response.error.code}: ${response.error.message}`)
  }
  const { result } = response
  if ('message' in result) {
    return fromHub(result.message.messageId, joinParts(result.message.parts), result.message.metadata)
  }
  const { task } = result
  if (!TERMINAL.has(task.status.state)) return errorReply(fallbackId, UNFINISHED_TASK)
  const parts = [...(task.artifacts ?? []).flatMap((a) => a.parts), ...(task.status.message?.parts ?? [])]
  const reply = fromHub(
    task.status.message?.messageId ?? task.id,
    joinParts(parts),
    task.metadata ?? task.status.message?.metadata,
  )
  if (task.status.state === 'TASK_STATE_REJECTED') reply.verdict = 'blocked'
  // A failed or canceled task is never a success, whatever the guardrails said.
  if (task.status.state === 'TASK_STATE_FAILED') return { ...reply, verdict: 'error', errorMessage: TASK_FAILED }
  if (task.status.state === 'TASK_STATE_CANCELED') return { ...reply, verdict: 'error', errorMessage: TASK_CANCELED }
  return reply
}
