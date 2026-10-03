import type { ApiErrorBody } from './types'

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Resolve against the page origin so relative paths also work under Node's fetch in tests.
  const url = new URL(apiPath(path), window.location.origin)
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new ApiError(0, 'Network error: could not reach the server')
  }

  const text = await response.text()
  const data = text ? parseJson(text) : null

  if (!response.ok) {
    const body = (data ?? {}) as Partial<ApiErrorBody>
    throw new ApiError(response.status, body.message ?? `Request failed (${response.status})`, body.field)
  }
  // e.g. index.html served for /api by the SPA rewrite when the real API is missing
  if (data === undefined) throw new ApiError(response.status, 'Unexpected response from the server')
  return data as T
}

export function getJson<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
