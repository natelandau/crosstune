import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { getInvalidChangeCount } from '../../db/meta'
import { SYNC_STATUS_LABELS, TRANSFER_STATUS_LABELS } from '../../sync/labels'
import {
  useLastSyncedAt,
  useSyncEngine,
  useSyncStatus,
  useTransferStatus,
} from '../../sync/SyncProvider'
import type { SyncStatus, TransferStatus } from '../../sync/types'
import { useAction } from '../../ui/useAction'
import { rejectedChanges } from './settingsCopy'

export interface SyncSettings {
  status: SyncStatus
  statusLabel: string
  transferStatus: TransferStatus
  transferLabel: string
  /** When the last sync finished, as an ISO instant, or null before the first. */
  lastSynced: string | null
  /** Names the changes the server rejected, or null when there are none. */
  rejectedMessage: string | null
  syncNow: () => void
  error: string | null
  pending: boolean
}

/** The full sync state, including the clean and running states the sync badge leaves out. */
export function useSyncSettings(): SyncSettings {
  const db = useDb()
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const transferStatus = useTransferStatus()
  const lastSynced = useLastSyncedAt()
  const rejected = useLiveQuery(() => getInvalidChangeCount(db), [db]) ?? 0
  const { error, pending, run } = useAction()
  return {
    status,
    statusLabel: SYNC_STATUS_LABELS[status],
    transferStatus,
    transferLabel: TRANSFER_STATUS_LABELS[transferStatus],
    lastSynced,
    rejectedMessage: rejected > 0 ? rejectedChanges(rejected) : null,
    syncNow: () => run(() => engine.sync()),
    error,
    pending,
  }
}
