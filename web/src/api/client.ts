import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './schema'
import type { Problem, SyncApi } from './types'

/** A non-2xx API answer. `problem` is null when the body is not a Problem document, such as a gateway's error page; branch on `problemType`, never on the message. */
export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly problemType: string | null
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
    /** Whole seconds from a `Retry-After` header, or null when absent or not a number of seconds. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(problem?.detail ?? `API request failed with status ${status}`)
    this.problemType = problem?.type ?? null
  }
}

/** No session token, so the request was never sent. Unlike a 401, the server has not refused anything. */
export class NoTokenError extends Error {
  override readonly name = 'NoTokenError'
  constructor() {
    super('No session token available')
  }
}

/** The request never reached the server: no connection, DNS failure, or a blocked origin. */
export class NetworkError extends Error {
  override readonly name = 'NetworkError'
  constructor(cause: unknown) {
    super('Network request failed', { cause })
  }
}

/** A presigned object PUT or GET failed. It carries no problem body: the signature, not the API, is its contract. */
export class TransferError extends Error {
  override readonly name = 'TransferError'
  constructor(readonly status: number) {
    super(`Object transfer failed with status ${status}`)
  }
}

const PUT_BASE_TIMEOUT_MS = 60_000
// About 128 kbps, the slowest link that still finishes a maximum-size file and its
// confirmation inside the API's one-hour upload slot.
const PUT_BYTES_PER_MS = 16
const GET_TIMEOUT_MS = 120_000
const API_TIMEOUT_MS = 60_000

/** Waits between attempts after a 502 or 504, about 15 s in all: enough for a sleeping API to wake. */
export const GATEWAY_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000, 8000]
// 503 is left out on purpose: the API sends it when a feature is not configured, which a retry cannot fix.
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 504])

export interface ApiClientOptions {
  baseUrl: string
  getToken: () => Promise<string | null>
  clientVersion: string
  fetch?: (request: Request) => Promise<Response>
  /** Override the PUT timeout formula (bytes in, ms out). Tests only. */
  putTimeoutMs?: (bytes: number) => number
  /** Override the fixed GET timeout in ms. Tests only. */
  getTimeoutMs?: number
  /** Override the per-attempt API timeout in ms. Tests only. */
  apiTimeoutMs?: number
  /** Override the waits between gateway retries in ms. Tests only. */
  gatewayRetryDelaysMs?: readonly number[]
}

export function createApiClient(options: ApiClientOptions): SyncApi {
  const baseFetch = options.fetch ?? ((input: Request) => globalThis.fetch(input))
  const putTimeoutMs =
    options.putTimeoutMs ??
    ((bytes: number) => Math.ceil(PUT_BASE_TIMEOUT_MS + bytes / PUT_BYTES_PER_MS))
  const getTimeoutMs = options.getTimeoutMs ?? GET_TIMEOUT_MS
  const apiTimeoutMs = options.apiTimeoutMs ?? API_TIMEOUT_MS
  const gatewayRetryDelaysMs = options.gatewayRetryDelaysMs ?? GATEWAY_RETRY_DELAYS_MS
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getToken()
      if (!token) throw new NoTokenError()
      request.headers.set('Authorization', `Bearer ${token}`)
      request.headers.set('X-Client-Version', options.clientVersion)
      return request
    },
  }

  // fetch consumes a request's body, so each attempt but the last sends a clone to keep the
  // body intact for a resend. The timeout signal also bounds the body read that follows.
  async function withGatewayRetries(input: Request): Promise<Response> {
    const attempt = (request: Request) =>
      baseFetch(new Request(request, { signal: AbortSignal.timeout(apiTimeoutMs) }))
    for (const delayMs of gatewayRetryDelaysMs) {
      const response = await attempt(input.clone())
      if (!GATEWAY_STATUSES.has(response.status)) return response
      discardBody(response)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    return attempt(input)
  }

  const client = createClient<paths>({
    // Unless a build supplies an origin, the client calls /v1 on its own: the
    // Vite proxy locally, the Worker when hosted. A browser resolves an empty
    // baseUrl against the page location on its own, but the fetch client needs
    // an absolute URL, so mirror that resolution.
    baseUrl: options.baseUrl || globalThis.location?.origin || '',
    fetch: withGatewayRetries,
  })
  client.use(auth)

  // Presigned URLs carry their own credential in the signature, so these bypass
  // openapi-fetch entirely and never receive the bearer token.
  async function transfer(request: Request): Promise<Response> {
    const response = await withNetworkErrors(() => baseFetch(request))
    if (response.ok) return response
    discardBody(response)
    throw new TransferError(response.status)
  }

  const byRecording = (recordingId: string) => ({
    params: { path: { recording_id: recordingId } },
  })

  const byPage = (pageId: string) => ({ params: { path: { page_id: pageId } } })

  return {
    async push(changes) {
      return unwrap(client.POST('/v1/sync/push', { body: { changes } }))
    },
    async pull(since) {
      return unwrap(client.GET('/v1/sync/pull', { params: { query: { since } } }))
    },
    async resolveLink(url) {
      return unwrap(client.POST('/v1/links/resolve', { body: { url } }))
    },
    async searchRecordings(q, providers, country) {
      return unwrap(
        client.GET('/v1/links/search', { params: { query: { q, providers, country } } }),
      )
    },
    async me() {
      return unwrap(client.GET('/v1/me'))
    },
    async deleteAccount() {
      return unwrapEmpty(client.DELETE('/v1/me'))
    },
    async requestUploadSlot(recordingId, body) {
      return unwrap(
        client.POST('/v1/recordings/{recording_id}/upload-slot', {
          ...byRecording(recordingId),
          body,
        }),
      )
    },
    async uploadFinished(recordingId) {
      return unwrapEmpty(
        client.POST('/v1/recordings/{recording_id}/uploaded', byRecording(recordingId)),
      )
    },
    async retryRecording(recordingId) {
      return unwrapEmpty(
        client.POST('/v1/recordings/{recording_id}/retry', byRecording(recordingId)),
      )
    },
    async downloadUrl(recordingId) {
      return unwrap(client.GET('/v1/recordings/{recording_id}/download', byRecording(recordingId)))
    },
    async peaksUrl(recordingId) {
      return unwrap(client.GET('/v1/recordings/{recording_id}/peaks', byRecording(recordingId)))
    },
    async requestNotationUploadSlot(pageId, body) {
      return unwrap(
        client.POST('/v1/notation-pages/{page_id}/upload-slot', { ...byPage(pageId), body }),
      )
    },
    async notationUploadFinished(pageId) {
      return unwrapEmpty(client.POST('/v1/notation-pages/{page_id}/uploaded', byPage(pageId)))
    },
    async notationDownloadUrl(pageId) {
      return unwrap(client.GET('/v1/notation-pages/{page_id}/download', byPage(pageId)))
    },
    async putObject(url, blob, contentType) {
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
    async getObject(url) {
      const response = await transfer(
        new Request(url, { signal: AbortSignal.timeout(getTimeoutMs) }),
      )
      // Reading the body can still time out or drop, so it needs its own wrapper.
      return withNetworkErrors(() => response.blob())
    },
  }
}

type ApiResult = { error?: unknown; response: Response }

// openapi-fetch reads the response body after fetch resolves, so the network wrapper has to
// cover the whole call for a dropped body read to surface as a NetworkError.
async function unwrap<T>(pending: Promise<ApiResult & { data?: T }>): Promise<T> {
  const result = await withNetworkErrors(() => pending)
  if (result.data !== undefined) return result.data
  throw apiError(result)
}

async function unwrapEmpty(pending: Promise<ApiResult>): Promise<void> {
  const result = await withNetworkErrors(() => pending)
  if (!result.response.ok) throw apiError(result)
}

function apiError(result: ApiResult): ApiError {
  return new ApiError(
    result.response.status,
    isProblem(result.error) ? result.error : null,
    parseRetryAfter(result.response.headers.get('Retry-After')),
  )
}

function parseRetryAfter(value: string | null): number | null {
  return value !== null && /^\d+$/.test(value.trim()) ? Number(value) : null
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

// An unread body holds its connection until garbage collection.
function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => {})
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
