import { onTestFinished } from 'vitest'
import { CrosstuneDb } from '../db/schema'

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
