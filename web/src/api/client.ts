import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './schema'
import type {
  Change,
  MeResponse,
  Problem,
  PullResponse,
  PushResponse,
  ResolveResponse,
  SignedUrl,
  SyncApi,
  UploadSlotRequest,
} from './types'

export class ApiError extends Error {
  readonly problemType: string | null
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? `API request failed with status ${status}`)
    this.name = 'ApiError'
    this.problemType = problem?.type ?? null
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

/** A presigned object PUT or GET failed. It carries no problem body: the signature, not the API, is its contract. */
export class TransferError extends Error {
  constructor(readonly status: number) {
    super(`Object transfer failed with status ${status}`)
    this.name = 'TransferError'
  }
}

const PUT_BASE_TIMEOUT_MS = 60_000
const PUT_BYTES_PER_MS = 50
const GET_TIMEOUT_MS = 120_000

export interface ApiClientOptions {
  baseUrl: string
  getToken: () => Promise<string | null>
  clientVersion: string
  fetch?: typeof fetch
  /** Override the PUT timeout formula (bytes in, ms out). Tests only. */
  putTimeoutMs?: (bytes: number) => number
  /** Override the fixed GET timeout in ms. Tests only. */
  getTimeoutMs?: number
}

export function createApiClient(options: ApiClientOptions): SyncApi {
  const baseFetch = options.fetch ?? ((input: Request) => globalThis.fetch(input))
  const putTimeoutMs =
    options.putTimeoutMs ??
    ((bytes: number) => Math.ceil(PUT_BASE_TIMEOUT_MS + bytes / PUT_BYTES_PER_MS))
  const getTimeoutMs = options.getTimeoutMs ?? GET_TIMEOUT_MS
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getToken()
      if (!token) throw new NoTokenError()
      request.headers.set('Authorization', `Bearer ${token}`)
      request.headers.set('X-Client-Version', options.clientVersion)
      return request
    },
  }

  // fetch signals an unreachable server with a bare TypeError, which is also what any
  // programming error throws; give the network case its own type so callers can tell.
  // A signal timeout rejects with a DOMException instead, so it needs the same treatment.
  async function withNetworkErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      const isTimeout =
        error instanceof DOMException &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw error instanceof TypeError || isTimeout ? new NetworkError(error) : error
    }
  }

  const client = createClient<paths>({
    // Unless a build supplies an origin, the client calls /v1 on its own: the
    // Vite proxy locally, the Worker when hosted. A browser resolves an empty
    // baseUrl against the page location on its own, but the fetch client needs
    // an absolute URL, so mirror that resolution.
    baseUrl: options.baseUrl || globalThis.location?.origin || '',
    fetch: (input) => withNetworkErrors(() => baseFetch(input)),
  })
  client.use(auth)

  function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
    if (result.data !== undefined) return result.data
    const problem = isProblem(result.error) ? result.error : null
    throw new ApiError(result.response.status, problem)
  }

  function unwrapEmpty(result: { error?: unknown; response: Response }): void {
    if (result.response.ok) return
    const problem = isProblem(result.error) ? result.error : null
    throw new ApiError(result.response.status, problem)
  }

  // Presigned URLs carry their own credential in the signature, so these bypass
  // openapi-fetch entirely and never receive the bearer token.
  async function transfer(request: Request): Promise<Response> {
    const response = await withNetworkErrors(() => baseFetch(request))
    if (!response.ok) throw new TransferError(response.status)
    return response
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
    async me(): Promise<MeResponse> {
      return unwrap(await client.GET('/v1/me'))
    },
    async requestUploadSlot(recordingId, body: UploadSlotRequest): Promise<SignedUrl> {
      return unwrap(
        await client.POST('/v1/recordings/{recording_id}/upload-slot', {
          params: { path: { recording_id: recordingId } },
          body,
        }),
      )
    },
    async uploadFinished(recordingId): Promise<void> {
      unwrapEmpty(
        await client.POST('/v1/recordings/{recording_id}/uploaded', {
          params: { path: { recording_id: recordingId } },
        }),
      )
    },
    async retryRecording(recordingId): Promise<void> {
      unwrapEmpty(
        await client.POST('/v1/recordings/{recording_id}/retry', {
          params: { path: { recording_id: recordingId } },
        }),
      )
    },
    async downloadUrl(recordingId): Promise<SignedUrl> {
      return unwrap(
        await client.GET('/v1/recordings/{recording_id}/download', {
          params: { path: { recording_id: recordingId } },
        }),
      )
    },
    async putObject(url, blob, contentType): Promise<void> {
      // A blob read back from IndexedDB is file-backed on iOS, and an iOS home-screen web
      // app cannot hand that file to the network layer ("Load failed"), so send the bytes
      // from memory. The read stays outside the network wrapper to keep its own error.
      const body = await blob.arrayBuffer()
      await transfer(
        new Request(url, {
          method: 'PUT',
          body,
          headers: { 'Content-Type': contentType },
          // A larger recording needs longer than the base allowance to reach R2 over a slow link.
          signal: AbortSignal.timeout(putTimeoutMs(blob.size)),
        }),
      )
    },
    async getObject(url): Promise<Blob> {
      return withNetworkErrors(
        async () =>
          await (
            await transfer(new Request(url, { signal: AbortSignal.timeout(getTimeoutMs) }))
          ).blob(),
      )
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
