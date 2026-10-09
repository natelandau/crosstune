import { ApiError, NetworkError, TransferError } from '../api/client'
import { isAuthFailure, QUOTA_PROBLEM } from '../sync/errors'
import type { FailureReason } from './events'

/** The plan's reason for a failure, from the error alone. */
export function failureReason(error: unknown): FailureReason {
  if (error instanceof NetworkError) return 'network'
  if (
    (error instanceof ApiError && error.problemType === QUOTA_PROBLEM) ||
    (error as { name?: unknown } | null)?.name === 'QuotaExceededError'
  ) {
    return 'storage_full'
  }
  if (isAuthFailure(error)) return 'auth_expired'
  if ((error instanceof ApiError || error instanceof TransferError) && error.status >= 500) {
    return 'server_error'
  }
  return 'other'
}

/** The reason a sync run failed: only the server's answer counts, so a local storage error is `other`. */
export function syncFailureReason(error: unknown): FailureReason {
  if (isAuthFailure(error)) return 'auth_expired'
  if (error instanceof ApiError && error.status >= 500) return 'server_error'
  return 'other'
}
