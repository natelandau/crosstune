import { forgetUser } from '../../auth/session'
import { clearSearchQueries } from '../catalog/searchSession'
import { pagesLive } from '../../db/notation'
import { NOT_UPLOADED_STATES } from '../../db/recordings'
import { deleteDatabase, type CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'

export const UNSYNCED_RECORDINGS_ERROR =
  'Some recordings have not uploaded yet. Delete them in Recordings, or wait until they upload.'

export const UNSYNCED_NOTATION_ERROR =
  'Some notation pages have not uploaded yet. Delete them from their tune, or wait until they upload.'

/** The catalog is the user's private data on a possibly shared phone: gone with a sign-out. */
export async function forgetLocalData({
  db,
  userId,
}: {
  db: CrosstuneDb
  userId: string
}): Promise<void> {
  db.close()
  await deleteDatabase(userId)
  forgetUser()
  clearSearchQueries()
}

/** A captured page the server has not received exists only in this database. The file of a page
 * that is deleted, or whose tune is, is dropped by the next transfer pass anyway, so it never
 * holds up a sign-out. */
async function hasUnuploadedPage(db: CrosstuneDb): Promise<boolean> {
  const captured = await db.notation_files.where('origin').equals('captured').primaryKeys()
  const pages = await db.notation_pages.bulkGet(captured)
  const live = await pagesLive(db, pages)
  return pages.some((page, i) => live[i] && page?.state === 'pending_upload')
}

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
  if (await hasUnuploadedPage(db)) throw new Error(UNSYNCED_NOTATION_ERROR)
  // A stopped engine ignores the triggers, so no sync can reopen the database being deleted.
  engine.stop()
  try {
    await signOut()
  } catch (error) {
    engine.resume()
    throw error
  }
  await forgetLocalData({ db, userId })
}
