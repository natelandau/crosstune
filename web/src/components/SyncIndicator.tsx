import { useLastSyncedAt, useSyncStatus } from '../sync/SyncProvider'
import type { SyncStatus } from '../sync/types'

const BADGES: Record<SyncStatus, { label: string; className: string }> = {
  idle: { label: 'Synced', className: 'badge-success' },
  syncing: { label: 'Syncing', className: 'badge-info' },
  offline: { label: 'Offline', className: 'badge-warning' },
  unauthorized: { label: 'Sign in again', className: 'badge-error' },
  error: { label: 'Sync failed', className: 'badge-error' },
}

export function SyncIndicator() {
  const status = useSyncStatus()
  const lastSyncedAt = useLastSyncedAt()
  const { label, className } = BADGES[status]
  return (
    <span
      role="status"
      data-testid="sync-status"
      data-status={status}
      data-synced-at={lastSyncedAt ?? ''}
      aria-label={label}
      className={`badge badge-sm ${className}`}
    >
      {status === 'syncing' ? <span className="loading loading-spinner loading-xs" /> : null}
      {label}
    </span>
  )
}
