import { ApiError, NoTokenError } from '../api/client'

/** No session token, or the server refusing one: nothing past this point can succeed
 * until the user signs in again. */
export function isAuthFailure(error: unknown): boolean {
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
