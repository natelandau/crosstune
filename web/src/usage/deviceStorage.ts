import { NOT_UPLOADED_STATES } from '../db/recordings'
import type { CrosstuneDb } from '../db/schema'
import { storageHeadroom } from '../platform/storage'
import { bytesBucket, countBucket } from './buckets'
import type { AnalyticsClient } from './client'

/**
 * Reports whether the browser keeps this origin's data, how many recordings only this device
 * holds, and how much room is left. Sends nothing where the browser does not say whether it
 * keeps the data.
 */
export async function reportDeviceStorage(
  db: CrosstuneDb,
  analytics: AnalyticsClient,
  {
    persisted = () => navigator.storage?.persisted?.(),
    headroom = storageHeadroom,
  }: {
    persisted?: () => Promise<boolean> | undefined
    headroom?: () => Promise<number | null>
  } = {},
): Promise<void> {
  const [kept, free, waiting] = await Promise.all([
    persisted(),
    headroom(),
    db.recording_files.where('local_state').anyOf(NOT_UPLOADED_STATES).count(),
  ])
  if (kept === undefined || free === null) return
  analytics.send('device_storage_checked', {
    storage_persisted: kept,
    recordings_waiting: countBucket(waiting),
    storage_free: bytesBucket(free),
  })
}
