import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAccountDeletedNotice,
  clearLocalSignOut,
  hasAccountDeletedNotice,
  locallySignedOutUser,
  rememberUser,
} from '../../auth/session'
import { ApiError } from '../../api/client'
import { ACCOUNT_DELETED_PROBLEM } from '../../sync/errors'
import { addUploadedFile, deleteRecording } from '../../commands/recordings'
import { createList, deleteList } from '../../commands/lists'
import { createTune, deleteTune } from '../../commands/tunes'
import { databaseName, openDatabase } from '../../db/schema'
import { fakeEngine } from '../../test/providers'
import {
  confirmMatches,
  countAccountData,
  deleteAccountAndForget,
  forgetDeletedAccount,
} from './deleteAccount'
import { DELETE_CONFIRMATION_TEXT } from './deleteAccountCopy'

function freshUser() {
  const userId = `user_${crypto.randomUUID()}`
  rememberUser(userId)
  return { userId, db: openDatabase(userId) }
}

describe('deleteAccountAndForget', () => {
  afterEach(() => {
    clearAccountDeletedNotice()
    clearLocalSignOut()
  })

  it('stops sync before the request and deletes the database after it', async () => {
    const { userId, db } = freshUser()
    await createTune(db, { title: 'X' }, { status: 'known' })
    const stop = vi.fn()
    const deleteAccount = vi.fn(async () => {})
    const signOut = vi.fn(async () => {})
    await deleteAccountAndForget({
      db,
      userId,
      engine: fakeEngine({ stop, deleteAccount }),
      signOut,
    })
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
      deleteAccount.mock.invocationCallOrder[0]!,
    )
    expect(deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0]!,
    )
    expect(await Dexie.exists(databaseName(userId))).toBe(false)
    expect(hasAccountDeletedNotice()).toBe(true)
  })

  it('skips the unsynced guard', async () => {
    const { userId, db } = freshUser()
    await createTune(db, { title: 'X' }, { status: 'known' })
    expect(await db.outbox.count()).toBeGreaterThan(0)
    const signOut = vi.fn(async () => {})
    await expect(
      deleteAccountAndForget({ db, userId, engine: fakeEngine(), signOut }),
    ).resolves.toBeUndefined()
  })

  it('keeps the database and resumes sync when the request fails', async () => {
    const { userId, db } = freshUser()
    await createTune(db, { title: 'X' }, { status: 'known' })
    const resume = vi.fn()
    const deleteAccount = vi.fn(async () => {
      throw new Error('server unreachable')
    })
    const signOut = vi.fn(async () => {})
    await expect(
      deleteAccountAndForget({
        db,
        userId,
        engine: fakeEngine({ resume, deleteAccount }),
        signOut,
      }),
    ).rejects.toThrow('server unreachable')
    expect(resume).toHaveBeenCalledOnce()
    expect(signOut).not.toHaveBeenCalled()
    expect(await Dexie.exists(databaseName(userId))).toBe(true)
    await db.delete()
  })

  it('forgets local data even when ending the session fails', async () => {
    const { userId, db } = freshUser()
    await createTune(db, { title: 'X' }, { status: 'known' })
    const signOut = vi.fn(async () => {
      throw new Error('Clerk unreachable')
    })
    await expect(
      deleteAccountAndForget({ db, userId, engine: fakeEngine(), signOut }),
    ).resolves.toBeUndefined()
    expect(await Dexie.exists(databaseName(userId))).toBe(false)
    expect(hasAccountDeletedNotice()).toBe(true)
    expect(locallySignedOutUser()).toBe(userId)
  })

  it('forgets local data when another device already deleted the account', async () => {
    const { userId, db } = freshUser()
    const deleteAccount = vi.fn(async () => {
      throw new ApiError(401, {
        type: ACCOUNT_DELETED_PROBLEM,
        title: 'Unauthorized',
        status: 401,
        detail: 'This account was deleted',
      })
    })
    await expect(
      deleteAccountAndForget({
        db,
        userId,
        engine: fakeEngine({ deleteAccount }),
        signOut: async () => {},
      }),
    ).resolves.toBeUndefined()
    expect(await Dexie.exists(databaseName(userId))).toBe(false)
    expect(hasAccountDeletedNotice()).toBe(true)
  })

  it('marks the notice before ending the session', async () => {
    const { userId, db } = freshUser()
    let noticeAtSignOut = false
    const signOut = vi.fn(async () => {
      noticeAtSignOut = hasAccountDeletedNotice()
    })
    await deleteAccountAndForget({ db, userId, engine: fakeEngine(), signOut })
    expect(noticeAtSignOut).toBe(true)
  })

  it('still reports the account deleted when forgetting local data fails', async () => {
    const { userId, db } = freshUser()
    const close = db.close.bind(db)
    db.close = () => {
      throw new Error('database busy')
    }
    await expect(
      deleteAccountAndForget({ db, userId, engine: fakeEngine(), signOut: async () => {} }),
    ).resolves.toBeUndefined()
    expect(hasAccountDeletedNotice()).toBe(true)
    expect(locallySignedOutUser()).toBe(userId)
    close()
    await Dexie.delete(databaseName(userId))
  })
})

describe('forgetDeletedAccount', () => {
  afterEach(() => {
    clearAccountDeletedNotice()
    clearLocalSignOut()
  })

  it('wipes and marks a device whose account another device deleted, without a request', async () => {
    const { userId, db } = freshUser()
    await createTune(db, { title: 'X' }, { status: 'known' })
    const stop = vi.fn()
    const deleteAccount = vi.fn(async () => {})
    const signOut = vi.fn(async () => {
      throw new Error('Clerk unreachable')
    })
    await forgetDeletedAccount({ db, userId, engine: fakeEngine({ stop, deleteAccount }), signOut })
    expect(stop).toHaveBeenCalled()
    expect(deleteAccount).not.toHaveBeenCalled()
    expect(signOut).toHaveBeenCalledOnce()
    expect(await Dexie.exists(databaseName(userId))).toBe(false)
    expect(hasAccountDeletedNotice()).toBe(true)
    expect(locallySignedOutUser()).toBe(userId)
  })
})

describe('confirmMatches', () => {
  const lower = DELETE_CONFIRMATION_TEXT.toLowerCase()
  const titleCase = lower[0]!.toUpperCase() + lower.slice(1)

  it.each([DELETE_CONFIRMATION_TEXT, ` ${lower} `, titleCase])('accepts %j', (text) => {
    expect(confirmMatches(text)).toBe(true)
  })

  it.each([DELETE_CONFIRMATION_TEXT.slice(0, -1), `${DELETE_CONFIRMATION_TEXT} IT`, ''])(
    'refuses %j',
    (text) => {
      expect(confirmMatches(text)).toBe(false)
    },
  )
})

describe('countAccountData', () => {
  it('ignores soft-deleted rows', async () => {
    const { db } = freshUser()
    await createTune(db, { title: 'Keep' }, { status: 'known' })
    const { tuneId: goneTune } = await createTune(db, { title: 'Gone' }, { status: 'known' })
    await deleteTune(db, goneTune)

    await createList(db, 'Keep')
    const goneList = await createList(db, 'Gone')
    await deleteList(db, goneList)

    await addUploadedFile(db, new File(['a'], 'a.m4a', { type: 'audio/mp4' }), {
      tuneId: null,
      label: null,
    })
    const goneRecording = await addUploadedFile(
      db,
      new File(['b'], 'b.m4a', { type: 'audio/mp4' }),
      { tuneId: null, label: null },
    )
    await deleteRecording(db, goneRecording)

    expect(await countAccountData(db)).toEqual({ tunes: 1, lists: 1, recordings: 1 })
    await db.delete()
  })
})
