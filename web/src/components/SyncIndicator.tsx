import { SYNC_STATUS_LABELS } from '../sync/labels'
import { useLastSyncedAt, useSyncStatus } from '../sync/SyncProvider'
import type { SyncStatus } from '../sync/types'

// The badge sits on the app bar's chrome, so the quiet states outline themselves in the bar's
// own text color and only the states that need attention bring a fill.
const BADGES: Record<SyncStatus, string> = {
  idle: 'badge-outline opacity-80',
  syncing: 'badge-outline',
  offline: 'badge-warning',
  unauthorized: 'badge-error',
  error: 'badge-error',
}

export function SyncIndicator() {
  const status = useSyncStatus()
  const lastSyncedAt = useLastSyncedAt()
  const label = SYNC_STATUS_LABELS[status]
  const className = BADGES[status]
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
