import { useFrame } from '../platform/frame'
import { SYNC_STATUS_LABELS } from '../sync/labels'
import { useLastSyncedAt, useSyncStatus } from '../sync/SyncProvider'
import { SYNC_ATTENTION } from './syncAttention'

/**
 * The sync state, shown only when it needs attention. The element stays in the DOM in every
 * state so the end-to-end suite can watch its attributes for the first clean run.
 */
export function SyncBadge() {
  const status = useSyncStatus()
  const lastSyncedAt = useLastSyncedAt()
  const tone = SYNC_ATTENTION[status]
  return (
    <span
      role="status"
      data-testid="sync-status"
      data-status={status}
      data-synced-at={lastSyncedAt ?? ''}
      className={
        tone ? `t-secondary bg-fill rounded-(--radius-capsule) px-3 py-1 ${tone}` : undefined
      }
    >
      {tone ? SYNC_STATUS_LABELS[status] : null}
    </span>
  )
}

/**
 * The phone's sync badge, for a screen title's trailing slot. Split and wide carry it in the
 * sidebar header instead, so there it renders nothing.
 */
export function ScreenSyncBadge() {
  return useFrame() === 'phone' ? <SyncBadge /> : null
}
