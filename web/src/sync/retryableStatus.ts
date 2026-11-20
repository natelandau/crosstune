/** Whether a later attempt can turn this HTTP status around: the server's own fault, an auth
 * failure, a timeout, or a rate limit. Any other 4xx refuses the request itself and will not
 * succeed as-is. Imports nothing, so the service worker can share the rule. */
export function isRetryableStatus(status: number): boolean {
  return status < 400 || status >= 500 || [401, 403, 408, 429].includes(status)
}
