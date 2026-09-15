import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient, NetworkError, NoTokenError, TransferError } from './client'

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

  it('requests an upload slot and reports the problem type on refusal', async () => {
    const fetch = vi.fn(async (input: Request) => {
      expect(input.url).toContain('/v1/recordings/r1/upload-slot')
      expect(await input.json()).toEqual({ bytes: 10, content_type: 'audio/mp4' })
      return new Response(
        JSON.stringify({
          type: 'urn:crosstune:quota-exceeded',
          title: 'Content Too Large',
          status: 413,
          detail: 'full',
        }),
        { status: 413, headers: { 'content-type': 'application/problem+json' } },
      )
    })
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => 't',
      clientVersion: '1',
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    await expect(
      api.requestUploadSlot('r1', { bytes: 10, content_type: 'audio/mp4' }),
    ).rejects.toMatchObject({
      status: 413,
      problemType: 'urn:crosstune:quota-exceeded',
    })
  })

  it('puts and gets objects at presigned URLs without the bearer token', async () => {
    // Vitest's jsdom Request shim converts a Blob body through fields laid out for an
    // older jsdom Blob than the one this repo pins; its native Request, one prototype
    // up, handles a real Blob body correctly, so the test talks to that directly.
    vi.stubGlobal('Request', Object.getPrototypeOf(Request) as typeof Request)
    try {
      const fetch = vi.fn(async (input: Request) => {
        expect(input.headers.get('Authorization')).toBeNull()
        if (input.method === 'PUT') {
          expect(input.headers.get('Content-Type')).toBe('audio/mp4')
          expect(await input.text()).toBe('abc')
          return new Response(null, { status: 200 })
        }
        return new Response('xyz', { status: 200, headers: { 'content-type': 'audio/mp4' } })
      })
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: async () => 't',
        clientVersion: '1',
        fetch: fetch as unknown as typeof globalThis.fetch,
      })
      await api.putObject('https://r2/put', new Blob(['abc']), 'audio/mp4')
      expect(await (await api.getObject('https://r2/get')).text()).toBe('xyz')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('wraps a failed object transfer as a network error', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => 't',
      clientVersion: '1',
      fetch,
    })
    await expect(api.getObject('https://r2/get')).rejects.toBeInstanceOf(NetworkError)
  })

  it('wraps a failed object body read as a network error', async () => {
    const fetch = vi.fn(async () => {
      const response = new Response('xyz', { status: 200 })
      vi.spyOn(response, 'blob').mockRejectedValue(new TypeError('network read failed'))
      return response
    })
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => 't',
      clientVersion: '1',
      fetch,
    })
    await expect(api.getObject('https://r2/get')).rejects.toBeInstanceOf(NetworkError)
  })

  it('turns a non-2xx object transfer into a TransferError', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }))
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => 't',
      clientVersion: '1',
      fetch,
    })
    const error = await api.getObject('https://r2/get').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TransferError)
    expect((error as TransferError).status).toBe(404)
  })

  it('aborts a stalled PUT once its timeout elapses and reports it as a network error', async () => {
    // See the "puts and gets objects" test above for why the global Request needs swapping.
    vi.stubGlobal('Request', Object.getPrototypeOf(Request) as typeof Request)
    try {
      const fetch = vi.fn((input: Request) => {
        return new Promise<Response>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => {
            reject(new DOMException('timed out', 'TimeoutError'))
          })
        })
      })
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: async () => 't',
        clientVersion: '1',
        fetch: fetch as unknown as typeof globalThis.fetch,
        putTimeoutMs: () => 5,
      })
      await expect(
        api.putObject('https://r2/put', new Blob(['abc']), 'audio/mp4'),
      ).rejects.toBeInstanceOf(NetworkError)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('aborts a stalled GET once its timeout elapses and reports it as a network error', async () => {
    const fetch = vi.fn((input: Request) => {
      return new Promise<Response>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => {
          reject(new DOMException('timed out', 'TimeoutError'))
        })
      })
    })
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: async () => 't',
      clientVersion: '1',
      fetch: fetch as unknown as typeof globalThis.fetch,
      getTimeoutMs: 5,
    })
    await expect(api.getObject('https://r2/get')).rejects.toBeInstanceOf(NetworkError)
  })
})
