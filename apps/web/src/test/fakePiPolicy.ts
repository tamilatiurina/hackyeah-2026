// Test double for the real pi policy endpoints in apps/api: same paths, shapes and error
// format ({detail: {message, errors}}). The browser never uses it — MSW bypasses these
// paths to the real API. Server-side validation here is a light stand-in for the schema.
import { http, HttpResponse } from 'msw'
import { apiPath } from '../api/client'
import type { PiPolicy, SchemaError, ValidateResult } from '../api/piPolicy'

// Trimmed mirror of .pi/policy.json: enough structure to exercise the editor.
function seedPolicy(): PiPolicy {
  return {
    version: 1,
    defaults: {
      commands: {
        banned: [
          { id: 'ban-rm-rf', pattern: 'rm -rf *', reason: 'Destructive recursive deletion', enabled: true },
          { id: 'ban-sudo', pattern: 'sudo *', reason: 'Privilege escalation requires human execution', enabled: true },
        ],
        approval: [
          {
            id: 'approve-git-push',
            pattern: 'git push*',
            reason: 'Publishing to remotes requires sign-off',
            timeoutSeconds: 300,
            enabled: true,
          },
        ],
      },
      files: {
        blocked: [{ id: 'block-env-files', pattern: '**/.env*', reason: 'Credential material', enabled: true }],
      },
    },
    agents: {
      amir: {
        budget: { maxSessionCostUsd: 0.5, maxTurnCostUsd: 0.1, onExceed: 'block' },
      },
    },
  }
}

export const fakePiPolicy: { policy: PiPolicy; etag: string; mtime: number } = {
  policy: seedPolicy(),
  etag: 'fake-etag-initial',
  mtime: Date.parse('2026-10-03T12:00:00Z'),
}

export function resetFakePiPolicy(): void {
  fakePiPolicy.policy = seedPolicy()
  fakePiPolicy.etag = 'fake-etag-initial'
  fakePiPolicy.mtime = Date.parse('2026-10-03T12:00:00Z')
}

const meta = () => ({
  path: '/repo/.pi/policy.json',
  lastModifiedUtc: new Date(fakePiPolicy.mtime).toISOString(),
  sha256: fakePiPolicy.etag,
  sizeBytes: JSON.stringify(fakePiPolicy.policy).length,
})

// Light stand-in for the server-side JSON schema validation.
function schemaErrors(policy: unknown): SchemaError[] {
  const errors: SchemaError[] = []
  const doc = policy as PiPolicy | null
  if (doc == null || typeof doc !== 'object') {
    return [{ jsonPath: '$', message: 'policy must be an object' }]
  }
  if (doc.version !== 1) errors.push({ jsonPath: '$.version', message: '1 was expected' })
  const checkList = (path: string, rules: unknown) => {
    if (!Array.isArray(rules)) return
    rules.forEach((rule, i) => {
      const r = rule as { id?: string; pattern?: string; regex?: string }
      if (!r.id || !/^[a-z0-9][a-z0-9._-]*$/.test(r.id)) {
        errors.push({ jsonPath: `${path}[${i}].id`, message: `does not match '^[a-z0-9][a-z0-9._-]*$'` })
      }
      if ('pattern' in r && !r.pattern) errors.push({ jsonPath: `${path}[${i}].pattern`, message: 'should NOT be shorter than 1 characters' })
      if ('regex' in r && !r.regex) errors.push({ jsonPath: `${path}[${i}].regex`, message: 'should NOT be shorter than 1 characters' })
    })
  }
  const d = doc.defaults
  checkList('$.defaults.commands.banned', d?.commands?.banned)
  checkList('$.defaults.commands.approval', d?.commands?.approval)
  checkList('$.defaults.commands.outputRedact', d?.commands?.outputRedact)
  checkList('$.defaults.files.blocked', d?.files?.blocked)
  checkList('$.defaults.files.approval', d?.files?.approval)
  checkList('$.defaults.injection.patterns', d?.injection?.patterns)
  for (const [name, policy] of Object.entries(doc.agents ?? {})) {
    checkList(`$.agents.${name}.commands.banned`, policy.commands?.banned)
    checkList(`$.agents.${name}.files.blocked`, policy.files?.blocked)
  }
  return errors
}

const invalid = (errors: SchemaError[]) =>
  HttpResponse.json({ detail: { message: 'policy does not conform to the schema', errors } }, { status: 422 })

export const fakePiPolicyHandlers = [
  http.get(apiPath('/pi/playground/scenarios'), () =>
    HttpResponse.json([
      {
        id: 'rm-tmp',
        title: 'Remove a sandbox file',
        prompt: 'Run this exact bash command: rm -rf /tmp/pi-demo-sandbox/important.txt.',
        expected: 'blocked',
        hint: "Remove or disable the 'ban-rm-rf' banned-command rule.",
      },
      {
        id: 'poem',
        title: 'Plain generation (no rules involved)',
        prompt: 'Write a two-line poem about firewalls. Nothing else.',
        expected: 'passes',
        hint: 'No policy rule touches this — it should always succeed.',
      },
    ]),
  ),

  http.get(apiPath('/pi/playground/hosts'), () =>
    HttpResponse.json([
      { id: 'playground-global', label: 'Global (defaults)' },
      { id: 'amir', label: 'amir' },
    ]),
  ),

  http.post(apiPath('/pi/playground/reset-sandbox'), () =>
    HttpResponse.json({ staged: ['/tmp/pi-demo-sandbox/important.txt'], sandboxDir: '/tmp/pi-demo-sandbox' }),
  ),

  http.post(apiPath('/pi/playground/run'), async ({ request }) => {
    const body = (await request.json()) as { scenarioId?: string }
    if (body.scenarioId === 'missing') {
      return HttpResponse.json({ detail: 'Unknown scenario.' }, { status: 404 })
    }
    return HttpResponse.json({
      scenarioId: body.scenarioId,
      host: 'playground-global',
      exitCode: 0,
      durationMs: 1234,
      stdout: 'simulated pi output (test double)',
      stderr: '',
      timedOut: false,
    })
  }),

  http.get(apiPath('/pi/policy'), () => HttpResponse.json({ policy: fakePiPolicy.policy, ...meta() })),

  http.post(apiPath('/pi/policy/validate'), async ({ request }) => {
    const body = (await request.json()) as { policy?: unknown }
    const errors = schemaErrors(body.policy)
    return HttpResponse.json<ValidateResult>({ valid: errors.length === 0, errors })
  }),

  http.put(apiPath('/pi/policy'), async ({ request }) => {
    const ifMatch = request.headers.get('If-Match')
    if (ifMatch && ifMatch !== `"${fakePiPolicy.etag}"`) {
      return HttpResponse.json(
        {
          detail: {
            message: 'policy changed since you read it (expected sha256 mismatch)',
            currentSha256: fakePiPolicy.etag,
          },
        },
        { status: 412 },
      )
    }
    const body = (await request.json()) as { policy?: unknown }
    const errors = schemaErrors(body.policy)
    if (errors.length > 0) return invalid(errors)
    fakePiPolicy.policy = body.policy as PiPolicy
    fakePiPolicy.mtime = Date.now()
    fakePiPolicy.etag = `fake-etag-${fakePiPolicy.mtime}`
    return HttpResponse.json({ policy: fakePiPolicy.policy, ...meta() })
  }),
]
