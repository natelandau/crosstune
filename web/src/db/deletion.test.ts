import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { markedForDeletion, markForDeletion, settleMarkedDeletion } from './deletion'
import { databaseName, openDatabase } from './schema'

async function existingDatabase(): Promise<string> {
  const userId = `user_${crypto.randomUUID()}`
  const db = openDatabase(userId)
  await db.open()
  db.close()
  return userId
}

describe('settleMarkedDeletion', () => {
  it.each([
    ['nobody is signed in', null, false],
    ['another user is signed in', 'user_other', false],
    ['the marked user is still signed in', 'marked', true],
  ])('when %s, keeps the database only for the marked user', async (_case, signedIn, kept) => {
    const userId = await existingDatabase()
    markForDeletion(userId)
    await settleMarkedDeletion(signedIn === 'marked' ? userId : signedIn)
    expect(await Dexie.exists(databaseName(userId))).toBe(kept)
    expect(markedForDeletion()).toBeNull()
    if (kept) await Dexie.delete(databaseName(userId))
  })

  it('deletes nothing without a mark', async () => {
    const userId = await existingDatabase()
    await settleMarkedDeletion(null)
    expect(await Dexie.exists(databaseName(userId))).toBe(true)
    await Dexie.delete(databaseName(userId))
  })
})
