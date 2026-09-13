// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { handleRequest, type Env } from './index'

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    WORKER_NAME: 'crosstune-web',
    API_ORIGIN_PRODUCTION: 'https://api.example.com',
    API_ORIGIN_DEVELOPMENT: 'https://api-development.up.railway.app',
    PREVIEW_API_ORIGINS: { get: async () => null },
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
    ...overrides,
  }
}

function sentRequest(upstream: ReturnType<typeof vi.fn>): Request {
  const first = upstream.mock.calls[0]?.[0]
  if (!(first instanceof Request)) throw new Error('upstream was not called with a Request')
  return first
}

describe('handleRequest', () => {
  it('proxies /v1 on the custom domain to the production API', async () => {
    const upstream = vi.fn(async () => new Response('ok'))
    const request = new Request('https://example.com/v1/sync/pull?since=3', {
      headers: { authorization: 'Bearer t', cookie: '__session=abc' },
    })
    await handleRequest(request, makeEnv(), upstream)
    const sent = sentRequest(upstream)
    expect(sent.url).toBe('https://api.example.com/v1/sync/pull?since=3')
    expect(sent.method).toBe('GET')
    expect(sent.headers.get('authorization')).toBe('Bearer t')
    expect(sent.headers.get('cookie')).toBeNull()
    expect(sent.redirect).toBe('manual')
  })

  it('proxies an aliased preview to the origin stored for its alias', async () => {
    const upstream = vi.fn(async () => new Response('ok'))
    const env = makeEnv({
      PREVIEW_API_ORIGINS: { get: async () => 'https://api-pr-7.up.railway.app' },
    })
    const request = new Request('https://feat-x-crosstune-web.acme.workers.dev/v1/me')
    await handleRequest(request, env, upstream)
    expect(sentRequest(upstream).url).toBe('https://api-pr-7.up.railway.app/v1/me')
  })

  it('forwards the method and body of a push', async () => {
    const upstream = vi.fn(async () => new Response('ok'))
    const request = new Request('https://example.com/v1/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"changes":[]}',
    })
    await handleRequest(request, makeEnv(), upstream)
    const sent = sentRequest(upstream)
    expect(sent.method).toBe('POST')
    expect(sent.headers.get('content-type')).toBe('application/json')
    expect(await sent.text()).toBe('{"changes":[]}')
  })

  it('returns the upstream response as is', async () => {
    const upstream = vi.fn(
      async () =>
        new Response('{"status":401}', {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        }),
    )
    const response = await handleRequest(
      new Request('https://example.com/v1/me'),
      makeEnv(),
      upstream,
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.text()).toBe('{"status":401}')
  })

  it('serves every other path from the assets binding', async () => {
    const upstream = vi.fn(async () => new Response('should not be called'))
    const assets = vi.fn(async () => new Response('<div id="root">', { status: 200 }))
    const env = makeEnv({ ASSETS: { fetch: assets } })
    const response = await handleRequest(
      new Request('https://example.com/songs/new'),
      env,
      upstream,
    )
    expect(await response.text()).toBe('<div id="root">')
    expect(upstream).not.toHaveBeenCalled()
  })
})
