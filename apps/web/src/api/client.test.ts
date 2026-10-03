import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { ApiError, apiPath, getJson, postJson } from './client'

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
})
