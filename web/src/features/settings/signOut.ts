import type { AnalyticsClient } from '../../usage/client'
import { forgetUser } from '../../auth/session'
import { clearSearchQueries } from '../../ui/searchSession'
import { scansLive } from '../../db/scans'
import { countUnsentChanges } from '../../db/outbox'
import { NOT_UPLOADED_STATES } from '../../db/recordings'
import { deleteDatabase, type CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'

export const UNSYNCED_RECORDINGS_ERROR =
  'Some recordings have not uploaded yet. Delete them in Recordings, or wait until they upload.'

export const UNSYNCED_SCANS_ERROR =
  'Some scans have not uploaded yet. Delete them from their tune, or wait until they upload.'

/** The catalog is the user's private data on a possibly shared phone: gone with a sign-out. */
export async function forgetLocalData({
  db,
  userId,
  analytics,
}: {
  db: CrosstuneDb
  userId: string
  analytics: AnalyticsClient
}): Promise<void> {
  // First, so the person is forgotten even when deleting the database fails.
  analytics.reset()
  db.close()
  await deleteDatabase(userId)
  forgetUser()
  clearSearchQueries()
}

/** A captured scan the server has not received exists only in this database. The file of a scan
 * that is deleted, or whose tune is, is dropped by the next transfer pass anyway, so it never
 * holds up a sign-out. */
async function hasUnuploadedScan(db: CrosstuneDb): Promise<boolean> {
  const captured = await db.scan_files.where('origin').equals('captured').primaryKeys()
  const scans = await db.scans.bulkGet(captured)
  const live = await scansLive(db, scans)
  return scans.some((scan, i) => live[i] && scan?.state === 'pending_upload')
}

export async function signOutAndForget({
  db,
  userId,
  engine,
  signOut,
  analytics,
}: {
  db: CrosstuneDb
  userId: string
  engine: SyncEngine
  signOut: () => Promise<void>
  analytics: AnalyticsClient
}): Promise<void> {
  // The catalog is deleted below, so anything still queued would go with it. Unsent plays and
  // other events go with it too: a few events are not worth blocking a sign-out.
  await engine.sync()
  if ((await countUnsentChanges(db)) > 0) {
    throw new Error('Some changes have not synced yet. Try again once they have.')
  }
  // A recording the server has never received exists only in the database deleted below.
  if ((await db.recording_files.where('local_state').anyOf(NOT_UPLOADED_STATES).count()) > 0) {
    throw new Error(UNSYNCED_RECORDINGS_ERROR)
  }
  if (await hasUnuploadedScan(db)) throw new Error(UNSYNCED_SCANS_ERROR)
  // A stopped engine ignores the triggers, so no sync can reopen the database being deleted.
  engine.stop()
  try {
    await signOut()
  } catch (error) {
    engine.resume()
    throw error
  }
  // Before the reset, which detaches the event from the person.
  analytics.send('signed_out', {})
  await forgetLocalData({ db, userId, analytics })
}
