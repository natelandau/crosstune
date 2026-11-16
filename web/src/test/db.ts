import { onTestFinished } from 'vitest'
import { CrosstuneDb, deleteDatabase, openDatabase } from '../db/schema'

/**
 * A fresh database the current test owns, deleted once the test finishes. The delete waits for
 * every afterEach, the setup file's unmount among them, so no live query is still reading the
 * database as it closes. Call it from a test or a beforeEach.
 */
export function openTestDb(): CrosstuneDb {
  const db = new CrosstuneDb(`crosstune-test-${crypto.randomUUID()}`)
  onTestFinished(() => db.delete())
  return db
}

/** A user's database, created on disk and closed, which the current test owns as `openTestDb`'s is. */
export async function createUserDb(
  userId: string = `user_${crypto.randomUUID()}`,
): Promise<string> {
  onTestFinished(() => deleteDatabase(userId))
  const db = openDatabase(userId)
  await db.open()
  db.close()
  return userId
}
