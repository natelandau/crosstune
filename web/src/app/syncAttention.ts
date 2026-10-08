import type { SyncStatus } from '../sync/types'

/** The sync states that need attention, each with its text color. */
export const SYNC_ATTENTION: Partial<Record<SyncStatus, string>> = {
  offline: 'text-warning',
  unauthorized: 'text-danger',
  error: 'text-danger',
}
