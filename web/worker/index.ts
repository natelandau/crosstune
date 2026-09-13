import { apiOrigin, type OriginEnv } from './origin'

export interface Env extends OriginEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export type Upstream = (request: Request) => Promise<Response>

const BODYLESS_METHODS = new Set(['GET', 'HEAD'])

/**
 * Proxy `/v1/*` to the API for this hostname and hand everything else to the
 * assets layer. `run_worker_first` in wrangler.jsonc keeps asset requests from
 * reaching here at all; the assets branch is the safety net.
 */
export async function handleRequest(
  request: Request,
  env: Env,
  upstream: Upstream = (req) => fetch(req),
): Promise<Response> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/v1/')) return env.ASSETS.fetch(request)

  const target = new URL(url.pathname + url.search, await apiOrigin(url.hostname, env))
  const headers = new Headers(request.headers)
  // Clerk's session cookie belongs to the site origin, not the API.
  headers.delete('cookie')
  // A streamed body needs duplex on Node, and the Workers runtime accepts it.
  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
    body: BODYLESS_METHODS.has(request.method) ? null : request.body,
    redirect: 'manual',
    duplex: 'half',
  }
  return upstream(new Request(target, init))
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
}
