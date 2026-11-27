import { ISO_TIMESTAMP } from './sharedCases'

/** A response the scripted server returns, in order, whatever the request. */
export interface ScriptedResponse {
  route: string
  status: number
  body: unknown
}

/** A request the client sent, as its method and path with query, and its parsed JSON body. */
export interface SentRequest {
  route: string
  body: unknown
}

/**
 * A JSON value with every ISO 8601 timestamp rewritten to one precision, so two bodies that
 * name the same instants compare equal.
 */
export function withCanonicalTimestamps(value: unknown): unknown {
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) {
    return new Date(value).toISOString()
  }
  if (Array.isArray(value)) return value.map(withCanonicalTimestamps)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, withCanonicalTimestamps(entry)]),
    )
  }
  return value
}

/**
 * A `fetch` for `createApiClient`, as the fixtures/sync-engine cases script it. Answers each
 * request with the next scripted response and records what was sent. A request with no response
 * left is recorded in `unexpected` and answered 500, and one whose route differs from the next
 * response's is recorded there too, so the case that sent it fails.
 */
export function createScriptedFetch(responses: readonly ScriptedResponse[]) {
  const queue = [...responses]
  const sent: SentRequest[] = []
  const unexpected: string[] = []
  let beforeRespond: (() => void) | null = null

  async function scriptedFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const route = `${request.method} ${url.pathname}${url.search}`
    const text = await request.text()
    sent.push({ route, body: text === '' ? null : JSON.parse(text) })
    const hook = beforeRespond
    beforeRespond = null
    hook?.()
    const next = queue.shift()
    if (!next) {
      unexpected.push(`${route}: no scripted response left`)
      return new Response(null, { status: 500 })
    }
    if (next.route !== route) unexpected.push(`${route}: the next response is for ${next.route}`)
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    })
  }

  return {
    fetch: scriptedFetch,
    sent,
    unexpected,
    /** How many scripted responses no request has taken yet. */
    remaining: () => queue.length,
    /** Run `hook` once, as the next request is answered. */
    onNextResponse(hook: () => void) {
      beforeRespond = hook
    },
  }
}
