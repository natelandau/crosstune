/** The Worker's runtime bindings that origin selection reads. */
export interface OriginEnv {
  WORKER_NAME: string
  API_ORIGIN_PRODUCTION: string
  API_ORIGIN_DEVELOPMENT: string
  PREVIEW_API_ORIGINS: { get(key: string, options?: { cacheTtl?: number }): Promise<string | null> }
}

const WORKERS_DEV = '.workers.dev'

/**
 * The preview alias when the hostname is `<alias>-<workerName>.<subdomain>.workers.dev`,
 * else null. The bare `<workerName>.<subdomain>.workers.dev` hostname has no alias.
 */
export function previewAlias(hostname: string, workerName: string): string | null {
  if (!hostname.endsWith(WORKERS_DEV)) return null
  const labels = hostname.split('.')
  const first = labels[0]
  if (labels.length !== 4 || first === undefined) return null
  const suffix = `-${workerName}`
  if (!first.endsWith(suffix) || first.length === suffix.length) return null
  return first.slice(0, -suffix.length)
}

/**
 * The API origin to proxy `/v1` to. Only aliased previews consult KV; a missing
 * entry or a failed read means the development API.
 */
export async function apiOrigin(hostname: string, env: OriginEnv): Promise<string> {
  if (!hostname.endsWith(WORKERS_DEV)) return env.API_ORIGIN_PRODUCTION
  const alias = previewAlias(hostname, env.WORKER_NAME)
  if (alias === null) return env.API_ORIGIN_DEVELOPMENT
  // The value changes at most once per pull request, so a five-minute edge cache
  // saves a KV round trip on every request.
  const stored = await env.PREVIEW_API_ORIGINS.get(alias, { cacheTtl: 300 }).catch(() => null)
  return stored ?? env.API_ORIGIN_DEVELOPMENT
}
