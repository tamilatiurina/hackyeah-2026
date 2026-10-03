
// FastAPI mounts every route under settings.API_V1_STR (apps/api/app/core/config.py).
export const API_PREFIX = '/api/v1'

export function apiPath(path: string): string {
  return `${API_PREFIX}${path}`
}

export class ApiError extends Error {
  readonly status: number
  readonly field: string | undefined

  constructor(status: number, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.field = field
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Our mock answers {message, field}; FastAPI answers {detail: string} or {detail: [{loc, msg}]}.
function errorFrom(status: number, data: unknown): ApiError {
  const body = (data !== null && typeof data === 'object' ? data : {}) as {
    message?: unknown
    field?: unknown
    detail?: unknown
  }
  if (typeof body.message === 'string') {
    return new ApiError(status, body.message, typeof body.field === 'string' ? body.field : undefined)
  }
  if (typeof body.detail === 'string') return new ApiError(status, body.detail)
  if (typeof body.detail === 'object' && body.detail !== null && 'message' in body.detail) {
    const detail = body.detail as { message?: unknown; errors?: unknown }
    if (typeof detail.message === 'string') return new ApiError(status, detail.message)
  }
  if (Array.isArray(body.detail) && body.detail.length > 0) {
    const first = body.detail[0] as { msg?: unknown; loc?: unknown }
    if (typeof first.msg === 'string') {
      const loc = Array.isArray(first.loc) ? first.loc : []
      const last: unknown = loc[loc.length - 1]
      // loc ["body"] means a model-level rule, not a field
      const field = loc.length > 1 && typeof last === 'string' ? last : undefined
      return new ApiError(status, first.msg.replace(/^Value error, /, ''), field)
    }
  }
  return new ApiError(status, `Request failed (${status})`)
}

type ExtraHeaders = Record<string, string>

let accessTokenProvider: () => string | null = () => null
let unauthorizedHandler: ((canRetry: boolean) => Promise<boolean>) | null = null

/** The auth layer supplies the current Supabase access token. */
export function setAccessTokenProvider(provider: () => string | null): void {
  accessTokenProvider = provider
}

/**
 * Called on a 401. With canRetry, the handler may refresh the session and resolve true to have the
 * request sent again once; otherwise (or when that fails) it signs the user out.
 */
export function setUnauthorizedHandler(handler: ((canRetry: boolean) => Promise<boolean>) | null): void {
  unauthorizedHandler = handler
}

async function request<T>(path: string, init: RequestInit = {}, canRetry = true): Promise<T> {
  // Resolve against the page origin so relative paths also work under Node's fetch in tests.
  const url = new URL(apiPath(path), window.location.origin)
  let response: Response
  try {
    const headers = new Headers(init.headers)
    const token = accessTokenProvider()
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    response = await fetch(url, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Network error: could not reach the server')
  }

  const text = await response.text()
  const data = text ? parseJson(text) : null

  if (response.status === 401 && unauthorizedHandler) {
    if (await unauthorizedHandler(canRetry)) return request<T>(path, init, false)
  }
  if (!response.ok) throw errorFrom(response.status, data)
  // e.g. index.html served for /api by the SPA rewrite when the real API is missing
  if (data === undefined) throw new ApiError(response.status, 'Unexpected response from the server')
  return data as T
}

function jsonInit(method: string, body: unknown, headers: ExtraHeaders): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }
}

export function getJson<T>(path: string, headers: ExtraHeaders = {}): Promise<T> {
  return request<T>(path, { headers })
}

export function postJson<T>(path: string, body: unknown, headers: ExtraHeaders = {}): Promise<T> {
  return request<T>(path, jsonInit('POST', body, headers))
}

export function putJson<T>(path: string, body: unknown, headers: ExtraHeaders = {}): Promise<T> {
  return request<T>(path, jsonInit('PUT', body, headers))
}

export function patchJson<T>(path: string, body: unknown, headers: ExtraHeaders = {}): Promise<T> {
  return request<T>(path, jsonInit('PATCH', body, headers))
}

export async function deleteJson(path: string, headers: ExtraHeaders = {}): Promise<void> {
  await request<null>(path, { method: 'DELETE', headers })
}
