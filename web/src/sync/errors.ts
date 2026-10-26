import { ApiError, NoTokenError } from '../api/client'

export const QUOTA_PROBLEM = 'urn:crosstune:quota-exceeded'

/** The problem type a 403 carries when the account's plan, not its session, refuses. */
export const PREMIUM_REQUIRED_PROBLEM = 'urn:crosstune:premium-required'

/** The push reason the server gives a change the account's plan refuses. */
export const PREMIUM_REQUIRED_REASON = 'premium required'
/** The push reason for a row whose recording the server does not have, as for a loop on a take
 * kept local until the user subscribes. */
export const MISSING_RECORDING_REASON = 'recording_id does not reference one of your recordings'

/** A 403 that refuses what the free plan does not include, which signing in again never changes. */
export function isPlanRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.problemType === PREMIUM_REQUIRED_PROBLEM
  )
}

/** No session token, or the server refusing one: nothing past this point can succeed
 * until the user signs in again. */
export function isAuthFailure(error: unknown): boolean {
  if (isPlanRefusal(error)) return false
  return (
    error instanceof NoTokenError ||
    (error instanceof ApiError && (error.status === 401 || error.status === 403))
  )
}

/** The problem type the API answers a deleted account's still-valid token with. */
export const ACCOUNT_DELETED_PROBLEM = 'urn:crosstune:account-deleted'

/** The account was deleted, from this device or another, so its local copy must go too. */
export function isAccountDeleted(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    error.problemType === ACCOUNT_DELETED_PROBLEM
  )
}

/** A refusal that a later attempt can turn around: the server's own fault, an auth failure, a
 * timeout, or a rate limit. Any other 4xx refuses the request itself and will not succeed as-is. */
export function isRetryableRefusal(error: ApiError): boolean {
  if (isPlanRefusal(error)) return false
  return (
    error.status < 400 ||
    error.status >= 500 ||
    isAuthFailure(error) ||
    [408, 429].includes(error.status)
  )
}
