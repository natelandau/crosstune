import type { SyncStatus, TransferStatus } from './types'

/** What each sync state is called wherever it is shown. */
export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  idle: 'Synced',
  syncing: 'Syncing',
  offline: 'Offline',
  unauthorized: 'Sign in again',
  error: 'Sync failed',
}

/** What each state of the recording upload and download loop is called. */
export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  idle: 'Up to date',
  transferring: 'Transferring',
  offline: 'Offline',
  error: 'Transfer failed',
}
