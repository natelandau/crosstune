import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { markedForDeletion, markForDeletion, settleMarkedDeletion } from './deletion'
import { databaseName } from './schema'
import { createUserDb } from '../test/db'

describe('settleMarkedDeletion', () => {
  it.each([
    ['nobody is signed in', null, false],
    ['another user is signed in', 'user_other', false],
    ['the marked user is still signed in', 'marked', true],
  ])('when %s, keeps the database only for the marked user', async (_case, signedIn, kept) => {
    const userId = await createUserDb()
    markForDeletion(userId)
    await settleMarkedDeletion(signedIn === 'marked' ? userId : signedIn)
    expect(await Dexie.exists(databaseName(userId))).toBe(kept)
    expect(markedForDeletion()).toEqual([])
  })

  it('deletes every marked database, not only the latest', async () => {
    const first = await createUserDb()
    const second = await createUserDb()
    markForDeletion(first)
    markForDeletion(second)
    await settleMarkedDeletion(null)
    expect(await Dexie.exists(databaseName(first))).toBe(false)
    expect(await Dexie.exists(databaseName(second))).toBe(false)
    expect(markedForDeletion()).toEqual([])
  })

  it('deletes nothing without a mark', async () => {
    const userId = await createUserDb()
    await settleMarkedDeletion(null)
    expect(await Dexie.exists(databaseName(userId))).toBe(true)
  })
})
