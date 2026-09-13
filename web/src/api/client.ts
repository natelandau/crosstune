import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './schema'
import type { Change, Problem, PullResponse, PushResponse, ResolveResponse, SyncApi } from './types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? `API request failed with status ${status}`)
    this.name = 'ApiError'
  }
}

export class NoTokenError extends Error {
  constructor() {
    super('No session token available')
    this.name = 'NoTokenError'
  }
}

/** The request never reached the server: no connection, DNS failure, or a blocked origin. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed', { cause })
    this.name = 'NetworkError'
  }
}

export interface ApiClientOptions {
  baseUrl: string
  getToken: () => Promise<string | null>
  clientVersion: string
  fetch?: typeof fetch
}

export function createApiClient(options: ApiClientOptions): SyncApi {
  const baseFetch = options.fetch ?? ((input: Request) => globalThis.fetch(input))
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getToken()
      if (!token) throw new NoTokenError()
      request.headers.set('Authorization', `Bearer ${token}`)
      request.headers.set('X-Client-Version', options.clientVersion)
      return request
    },
  }

  const client = createClient<paths>({
    // The client always calls /v1 on its own origin: the Vite proxy locally, the
    // Worker when hosted. A browser resolves an empty baseUrl against the page
    // location on its own, but the fetch client needs an absolute URL, so mirror
    // that resolution.
    baseUrl: options.baseUrl || globalThis.location?.origin || '',
    // fetch signals an unreachable server with a bare TypeError, which is also what any
    // programming error throws; give the network case its own type so callers can tell.
    fetch: async (input) => {
      try {
        return await baseFetch(input)
      } catch (error) {
        throw error instanceof TypeError ? new NetworkError(error) : error
      }
    },
  })
  client.use(auth)

  function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
    if (result.data !== undefined) return result.data
    const problem = isProblem(result.error) ? result.error : null
    throw new ApiError(result.response.status, problem)
  }

  return {
    async push(changes: Change[]): Promise<PushResponse> {
      return unwrap(await client.POST('/v1/sync/push', { body: { changes } }))
    },
    async pull(since: number): Promise<PullResponse> {
      return unwrap(await client.GET('/v1/sync/pull', { params: { query: { since } } }))
    },
    async resolveLink(url: string): Promise<ResolveResponse> {
      return unwrap(await client.POST('/v1/links/resolve', { body: { url } }))
    },
  }
}

function isProblem(value: unknown): value is Problem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'title' in value &&
    'detail' in value
  )
}
