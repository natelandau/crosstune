import { SYNC_STATUS_LABELS } from '../sync/labels'
import type { SyncStatus } from '../sync/types'
import { useLastSyncedAt, useSyncStatus } from '../sync/SyncProvider'
import { Capsule } from './Capsule'

const ATTENTION: Partial<Record<SyncStatus, { label: string; tone: 'warning' | 'danger' }>> = {
  offline: { label: SYNC_STATUS_LABELS.offline, tone: 'warning' },
  unauthorized: { label: SYNC_STATUS_LABELS.unauthorized, tone: 'danger' },
  error: { label: SYNC_STATUS_LABELS.error, tone: 'danger' },
}

/**
 * The sync state, shown only when it needs attention. A clean or running sync says nothing;
 * Settings is where the full state is read. The element stays in the DOM in every state so the
 * end-to-end suite can watch its attributes for the first clean run, and carries `sync-badge`
 * only while it has something to show, so a layout around it makes room for it only then.
 */
export function SyncBadge() {
  const status = useSyncStatus()
  const lastSyncedAt = useLastSyncedAt()
  const attention = ATTENTION[status]
  return (
    <span
      role="status"
      data-testid="sync-status"
      data-status={status}
      data-synced-at={lastSyncedAt ?? ''}
      className={attention ? 'sync-badge' : undefined}
    >
      {attention ? <Capsule tone={attention.tone}>{attention.label}</Capsule> : null}
    </span>
  )
}
