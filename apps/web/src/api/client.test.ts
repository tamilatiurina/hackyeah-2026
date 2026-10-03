import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { ApiError, apiPath, deleteJson, getJson, patchJson, postJson } from './client'

describe('api client', () => {
  it('sends requests under /api/v1, where FastAPI mounts its routes', async () => {
    let seen = ''
    server.use(
      http.get('/api/v1/ping', ({ request }) => {
        seen = new URL(request.url).pathname
        return HttpResponse.json({ ok: true })
      }),
    )
    await getJson('/ping')
    expect(seen).toBe('/api/v1/ping')
  })

  it('returns parsed JSON on success', async () => {
    server.use(http.get(apiPath('/ping'), () => HttpResponse.json({ ok: true })))
    await expect(getJson<{ ok: boolean }>('/ping')).resolves.toEqual({ ok: true })
  })

  it('sends JSON bodies on POST', async () => {
    server.use(http.post(apiPath('/echo'), async ({ request }) => HttpResponse.json(await request.json())))
    await expect(postJson('/echo', { name: 'x' })).resolves.toEqual({ name: 'x' })
  })

  it('throws ApiError with the server message and field', async () => {
    server.use(
      http.post(apiPath('/fail'), () =>
        HttpResponse.json({ message: 'Name taken', field: 'name' }, { status: 409 }),
      ),
    )
    const error = await postJson('/fail', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, message: 'Name taken', field: 'name' })
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    server.use(http.get(apiPath('/fail'), () => new HttpResponse('oops', { status: 500 })))
    await expect(getJson('/fail')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (500)',
    })
  })

  it('rejects an HTML page served for /api (mock off behind the SPA rewrite)', async () => {
    server.use(
      http.get(apiPath('/agents-html'), () =>
        new HttpResponse('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } }),
      ),
    )
    await expect(getJson('/agents-html')).rejects.toMatchObject({
      status: 200,
      message: 'Unexpected response from the server',
    })
  })

  it('turns a network failure into ApiError with status 0', async () => {
    server.use(http.get(apiPath('/down'), () => HttpResponse.error()))
    await expect(getJson('/down')).rejects.toMatchObject({
      status: 0,
      message: 'Network error: could not reach the server',
    })
  })

  it('reads FastAPI string details', async () => {
    server.use(http.get(apiPath('/missing'), () => HttpResponse.json({ detail: 'Guardrail not found' }, { status: 404 })))
    await expect(getJson('/missing')).rejects.toMatchObject({ status: 404, message: 'Guardrail not found' })
  })

  it('reads FastAPI validation details without the "Value error" prefix', async () => {
    server.use(
      http.post(apiPath('/invalid'), () =>
        HttpResponse.json(
          {
            detail: [
              { type: 'value_error', loc: ['body', 'name'], msg: 'Value error, name is too long', input: 'x' },
            ],
          },
          { status: 422 },
        ),
      ),
    )
    await expect(postJson('/invalid', {})).rejects.toMatchObject({
      status: 422,
      message: 'name is too long',
      field: 'name',
    })
  })

  it('does not report a model-level error as a field called body', async () => {
    server.use(
      http.post(apiPath('/invalid'), () =>
        HttpResponse.json(
          { detail: [{ type: 'value_error', loc: ['body'], msg: "Value error, engine 'regex' not allowed", input: {} }] },
          { status: 422 },
        ),
      ),
    )
    const error = await postJson('/invalid', {}).catch((e: unknown) => e)
    expect(error).toMatchObject({ message: "engine 'regex' not allowed", field: undefined })
  })

  it('sends PATCH and DELETE with extra headers', async () => {
    const seen: string[] = []
    server.use(
      http.patch(apiPath('/thing'), async ({ request }) => {
        seen.push(`PATCH ${request.headers.get('X-Role')}`)
        return HttpResponse.json(await request.json())
      }),
      http.delete(apiPath('/thing'), ({ request }) => {
        seen.push(`DELETE ${request.headers.get('X-Role')}`)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await expect(patchJson('/thing', { enabled: false }, { 'X-Role': 'admin' })).resolves.toEqual({ enabled: false })
    await expect(deleteJson('/thing', { 'X-Role': 'admin' })).resolves.toBeUndefined()
    expect(seen).toEqual(['PATCH admin', 'DELETE admin'])
  })
})
