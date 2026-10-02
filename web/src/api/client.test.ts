import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ApiClientOptions,
  ApiError,
  createApiClient,
  GATEWAY_RETRY_DELAYS_MS,
  NetworkError,
  NoTokenError,
  TransferError,
} from './client'
import type { Change } from './types'

type FetchMock = (input: Request) => Promise<Response>

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function problemResponse(status: number, detail = 'x', type = 'about:blank') {
  return jsonResponse(
    { type, title: 'Problem', status, detail },
    { status, headers: { 'content-type': 'application/problem+json' } },
  )
}

function makeClient(fetch: FetchMock, overrides: Partial<ApiClientOptions> = {}) {
  return createApiClient({
    baseUrl: 'http://api.test',
    getToken: async () => 'tok',
    clientVersion: '1',
    fetch,
    ...overrides,
  })
}

// Resolves when the request's signal aborts, the way a real fetch rejects on a timeout.
function stalledFetch(input: Request) {
  return new Promise<Response>((_resolve, reject) => {
    input.signal.addEventListener('abort', () => {
      reject(new DOMException('timed out', 'TimeoutError'))
    })
  })
}

describe('createApiClient', () => {
  it('attaches the bearer token and the client version', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse({ results: [] }))
    await makeClient(fetchMock, { clientVersion: '1.2.3' }).push([])
    const request = fetchMock.mock.calls[0]![0]
    expect(request.url).toBe('http://api.test/v1/sync/push')
    expect(request.headers.get('authorization')).toBe('Bearer tok')
    expect(request.headers.get('x-client-version')).toBe('1.2.3')
  })

  it('sends since as a query parameter on pull', async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      jsonResponse({ rows: [], next_since: 7, has_more: false }),
    )
    const page = await makeClient(fetchMock).pull(7)
    expect(page.next_since).toBe(7)
    expect(fetchMock.mock.calls[0]![0].url).toBe('http://api.test/v1/sync/pull?since=7')
  })

  it('throws NoTokenError without calling fetch when there is no session', async () => {
    const fetchMock = vi.fn<FetchMock>()
    const api = makeClient(fetchMock, { baseUrl: '', getToken: async () => null })
    await expect(api.pull(0)).rejects.toBeInstanceOf(NoTokenError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('wraps a failed fetch in NetworkError and leaves other throws alone', async () => {
    const client = (error: unknown) =>
      makeClient(async () => {
        throw error
      })
    await expect(client(new TypeError('Failed to fetch')).pull(0)).rejects.toBeInstanceOf(
      NetworkError,
    )
    await expect(client(new RangeError('boom')).pull(0)).rejects.toBeInstanceOf(RangeError)
  })

  it('wraps a failed response body read in NetworkError', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => {
      const response = jsonResponse({ rows: [], next_since: 0, has_more: false })
      vi.spyOn(response, 'text').mockRejectedValue(new TypeError('network read failed'))
      vi.spyOn(response, 'json').mockRejectedValue(new TypeError('network read failed'))
      return response
    })
    await expect(makeClient(fetchMock).pull(0)).rejects.toBeInstanceOf(NetworkError)
  })

  it('wraps a token lookup that cannot reach the network in NetworkError', async () => {
    const api = makeClient(vi.fn<FetchMock>(), {
      getToken: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await expect(api.pull(0)).rejects.toBeInstanceOf(NetworkError)
  })

  it('aborts a stalled API request once its timeout elapses and reports it as a network error', async () => {
    const api = makeClient(vi.fn(stalledFetch), { apiTimeoutMs: 5 })
    await expect(api.pull(0)).rejects.toBeInstanceOf(NetworkError)
  })

  it('turns a problem response into ApiError', async () => {
    const api = makeClient(async () => problemResponse(401, 'nope'))
    await expect(api.resolveLink('https://youtu.be/x')).rejects.toSatisfy(
      (error) =>
        error instanceof ApiError && error.status === 401 && error.problem?.detail === 'nope',
    )
  })

  it('sends DELETE /v1/me and resolves on 204', async () => {
    const fetchMock = vi.fn<FetchMock>(async (input) => {
      expect(input.method).toBe('DELETE')
      expect(input.url).toBe('http://api.test/v1/me')
      return new Response(null, { status: 204 })
    })
    await expect(makeClient(fetchMock).deleteAccount()).resolves.toBeUndefined()
  })

  it('throws ApiError when deleteAccount gets a 502', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => problemResponse(502, 'down'))
    const api = makeClient(fetchMock, { gatewayRetryDelaysMs: [] })
    await expect(api.deleteAccount()).rejects.toSatisfy(
      (error) => error instanceof ApiError && error.status === 502,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requests an upload slot and reports the problem type on refusal', async () => {
    const api = makeClient(async (input) => {
      expect(input.url).toContain('/v1/recordings/r1/upload-slot')
      expect(await input.json()).toEqual({ bytes: 10, content_type: 'audio/mp4' })
      return problemResponse(413, 'full', 'urn:crosstune:quota-exceeded')
    })
    await expect(
      api.requestUploadSlot('r1', { bytes: 10, content_type: 'audio/mp4' }),
    ).rejects.toMatchObject({
      status: 413,
      problemType: 'urn:crosstune:quota-exceeded',
    })
  })

  describe('presigned transfers', () => {
    // Vitest's jsdom Request shim converts a Blob body through fields laid out for an
    // older jsdom Blob than the one this repo pins; its native Request, one prototype
    // up, handles a real Blob body correctly, so these tests talk to that directly.
    beforeEach(() => {
      vi.stubGlobal('Request', Object.getPrototypeOf(Request) as typeof Request)
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('puts and gets objects at presigned URLs without the bearer token', async () => {
      const api = makeClient(async (input) => {
        expect(input.headers.get('Authorization')).toBeNull()
        if (input.method === 'PUT') {
          expect(input.headers.get('Content-Type')).toBe('audio/mp4')
          expect(await input.text()).toBe('abc')
          return new Response(null, { status: 200 })
        }
        return new Response('xyz', { status: 200, headers: { 'content-type': 'audio/mp4' } })
      })
      await api.putObject('https://r2/put', new Blob(['abc']), 'audio/mp4')
      expect(await (await api.getObject('https://r2/get')).text()).toBe('xyz')
    })

    it('reads the blob into memory before the PUT so the request never carries a file-backed body', async () => {
      const blob = new Blob(['abc'])
      const read = vi.spyOn(blob, 'arrayBuffer')
      const fetchMock = vi.fn<FetchMock>(async (input) => {
        expect(read).toHaveBeenCalledTimes(1)
        expect(await input.text()).toBe('abc')
        return new Response(null, { status: 200 })
      })
      await makeClient(fetchMock).putObject('https://r2/put', blob, 'audio/mp4')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('aborts a stalled PUT once its timeout elapses and reports it as a network error', async () => {
      const api = makeClient(vi.fn(stalledFetch), { putTimeoutMs: () => 5 })
      await expect(
        api.putObject('https://r2/put', new Blob(['abc']), 'audio/mp4'),
      ).rejects.toBeInstanceOf(NetworkError)
    })

    it('does not retry a presigned transfer', async () => {
      const fetchMock = vi.fn<FetchMock>(async () => new Response(null, { status: 502 }))
      const api = makeClient(fetchMock, { gatewayRetryDelaysMs: [0, 0, 0, 0, 0] })
      await expect(
        api.putObject('https://r2/put', new Blob(['abc']), 'audio/mp4'),
      ).rejects.toSatisfy((error) => error instanceof TransferError && error.status === 502)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('reports an unreadable blob as its own error, not a network failure', async () => {
    const blob = new Blob(['abc'])
    vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(
      new TypeError('The object can not be found here.'),
    )
    const fetchMock = vi.fn<FetchMock>()
    const api = makeClient(fetchMock)
    await expect(api.putObject('https://r2/put', blob, 'audio/mp4')).rejects.toThrow(
      'The object can not be found here.',
    )
    await expect(api.putObject('https://r2/put', blob, 'audio/mp4')).rejects.not.toBeInstanceOf(
      NetworkError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('wraps a failed object transfer as a network error', async () => {
    const api = makeClient(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(api.getObject('https://r2/get')).rejects.toBeInstanceOf(NetworkError)
  })

  it('wraps a failed object body read as a network error', async () => {
    const api = makeClient(async () => {
      const response = new Response('xyz', { status: 200 })
      vi.spyOn(response, 'blob').mockRejectedValue(new TypeError('network read failed'))
      return response
    })
    await expect(api.getObject('https://r2/get')).rejects.toBeInstanceOf(NetworkError)
  })

  it('turns a non-2xx object transfer into a TransferError', async () => {
    const api = makeClient(async () => new Response(null, { status: 404 }))
    await expect(api.getObject('https://r2/get')).rejects.toSatisfy(
      (error) => error instanceof TransferError && error.status === 404,
    )
  })

  it('aborts a stalled GET once its timeout elapses and reports it as a network error', async () => {
    const api = makeClient(vi.fn(stalledFetch), { getTimeoutMs: 5 })
    await expect(api.getObject('https://r2/get')).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('gateway retries', () => {
  const clientWith = (fetchMock: FetchMock) =>
    makeClient(fetchMock, { gatewayRetryDelaysMs: [0, 0, 0, 0, 0] })

  it('retries a 502 and resolves', async () => {
    const fetchMock = vi
      .fn<FetchMock>()
      .mockImplementationOnce(async () => problemResponse(502))
      .mockImplementationOnce(async () => problemResponse(504))
      .mockImplementationOnce(async () =>
        jsonResponse({ rows: [], next_since: 3, has_more: false }),
      )
    const page = await clientWith(fetchMock).pull(0)
    expect(page.next_since).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('releases the body of each response it retries past', async () => {
    const gateway = problemResponse(502)
    const fetchMock = vi
      .fn<FetchMock>()
      .mockImplementationOnce(async () => gateway)
      .mockImplementationOnce(async () =>
        jsonResponse({ rows: [], next_since: 0, has_more: false }),
      )
    await clientWith(fetchMock).pull(0)
    expect(gateway.bodyUsed).toBe(true)
  })

  it('gives up after five retries', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => problemResponse(502))
    await expect(clientWith(fetchMock).pull(0)).rejects.toSatisfy(
      (error) => error instanceof ApiError && error.status === 502,
    )
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('does not retry a 503', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => problemResponse(503))
    await expect(clientWith(fetchMock).pull(0)).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resends the body on a retry', async () => {
    const bodies: string[] = []
    const fetchMock = vi
      .fn<FetchMock>()
      .mockImplementationOnce(async (input) => {
        bodies.push(await input.text())
        return problemResponse(502)
      })
      .mockImplementationOnce(async (input) => {
        bodies.push(await input.text())
        return jsonResponse({ results: [] })
      })
    const change = { table: 'tunes', row: { id: 't1' } } as unknown as Change
    await clientWith(fetchMock).push([change])
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).not.toBe('')
    expect(bodies[1]).toBe(bodies[0])
  })

  it('uses the default schedule', () => {
    expect(GATEWAY_RETRY_DELAYS_MS).toEqual([500, 1000, 2000, 4000, 8000])
  })
})
