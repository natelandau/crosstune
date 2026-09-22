import { forgetUser } from '../../auth/session'
import { clearSearchQuery } from '../catalog/searchSession'
import { NOT_UPLOADED_STATES } from '../../db/recordings'
import { deleteDatabase, type CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'

export const UNSYNCED_RECORDINGS_ERROR =
  'Some recordings have not uploaded yet. Delete them in Recordings, or wait until they upload.'

export async function signOutAndForget({
  db,
  userId,
  engine,
  signOut,
}: {
  db: CrosstuneDb
  userId: string
  engine: SyncEngine
  signOut: () => Promise<void>
}): Promise<void> {
  // The catalog is deleted below, so anything still queued would go with it.
  await engine.sync()
  if ((await db.outbox.count()) > 0) {
    throw new Error('Some changes have not synced yet. Try again once they have.')
  }
  // A recording the server has never received exists only in the database deleted below.
  if ((await db.recording_files.where('local_state').anyOf(NOT_UPLOADED_STATES).count()) > 0) {
    throw new Error(UNSYNCED_RECORDINGS_ERROR)
  }
  // A stopped engine ignores the triggers, so no sync can reopen the database being deleted.
  engine.stop()
  try {
    await signOut()
  } catch (error) {
    engine.resume()
    throw error
  }
  // The catalog is the user's private data on a possibly shared phone: gone with the session.
  db.close()
  await deleteDatabase(userId)
  forgetUser()
  clearSearchQuery()
}
