import { forgetUser } from '../../auth/session'
import { deleteDatabase, type CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'

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
}
