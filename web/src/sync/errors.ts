import { ApiError, NoTokenError } from '../api/client'

/** No session token, or the server refusing one: nothing past this point can succeed
 * until the user signs in again. */
export function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof NoTokenError ||
    (error instanceof ApiError && (error.status === 401 || error.status === 403))
  )
}
