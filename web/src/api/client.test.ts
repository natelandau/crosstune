import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient, NetworkError, NoTokenError } from './client'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('createApiClient', () => {
  it('attaches the bearer token and the client version', async () => {
    const fetchMock = vi.fn<(input: Request) => Promise<Response>>(async () =>
      jsonResponse({ results: [] }),
    )
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getToken: async () => 'tok',
      clientVersion: '1.2.3',
      fetch: fetchMock as unknown as typeof fetch,
    })
    await api.push([])
    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('http://api.test/v1/sync/push')
    expect(request.headers.get('authorization')).toBe('Bearer tok')
    expect(request.headers.get('x-client-version')).toBe('1.2.3')
  })

  it('sends since as a query parameter on pull', async () => {
    const fetchMock = vi.fn<(input: Request) => Promise<Response>>(async () =>
      jsonResponse({ rows: [], next_since: 7, has_more: false }),
    )
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getToken: async () => 'tok',
      clientVersion: '1',
      fetch: fetchMock as unknown as typeof fetch,
    })
    const page = await api.pull(7)
    expect(page.next_since).toBe(7)
    expect((fetchMock.mock.calls[0]?.[0] as Request).url).toBe(
      'http://api.test/v1/sync/pull?since=7',
    )
  })

  it('throws NoTokenError without calling fetch when there is no session', async () => {
    const fetchMock = vi.fn()
    const api = createApiClient({
      baseUrl: '',
      getToken: async () => null,
      clientVersion: '1',
      fetch: fetchMock as unknown as typeof fetch,
    })
    await expect(api.pull(0)).rejects.toBeInstanceOf(NoTokenError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('wraps a failed fetch in NetworkError and leaves other throws alone', async () => {
    const client = (error: unknown) =>
      createApiClient({
        baseUrl: '',
        getToken: async () => 'tok',
        clientVersion: '1',
        fetch: vi.fn(async () => {
          throw error
        }) as unknown as typeof fetch,
      })
    await expect(client(new TypeError('Failed to fetch')).pull(0)).rejects.toBeInstanceOf(
      NetworkError,
    )
    await expect(client(new RangeError('boom')).pull(0)).rejects.toBeInstanceOf(RangeError)
  })

  it('turns a problem response into ApiError', async () => {
    const problem = { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'nope' }
    const fetchMock = vi.fn(async () =>
      jsonResponse(problem, {
        status: 401,
        headers: { 'content-type': 'application/problem+json' },
      }),
    )
    const api = createApiClient({
      baseUrl: '',
      getToken: async () => 'tok',
      clientVersion: '1',
      fetch: fetchMock as unknown as typeof fetch,
    })
    const error = await api.resolveLink('https://youtu.be/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(401)
    expect((error as ApiError).problem?.detail).toBe('nope')
  })
})
