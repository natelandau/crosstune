import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { rememberedUser, rememberUser } from '../../auth/session'
import { addNotationPages } from '../../commands/notation'
import { addUploadedFile, setFileState } from '../../commands/recordings'
import { createTune } from '../../commands/tunes'
import { databaseName, openDatabase } from '../../db/schema'
import { readSearchQuery, writeSearchQuery } from '../catalog/searchSession'
import { serverTune } from '../../test/fakeApi'
import { fakeEngine } from '../../test/providers'
import { applyPullPage } from '../../sync/apply'
import { signOutAndForget, UNSYNCED_NOTATION_ERROR, UNSYNCED_RECORDINGS_ERROR } from './signOut'

function freshUser() {
  const userId = `user_${crypto.randomUUID()}`
  rememberUser(userId)
  return { userId, db: openDatabase(userId) }
}

describe('signOutAndForget', () => {
  it('flushes the outbox, stops sync, signs out of Clerk, then deletes the local database', async () => {
    const { userId, db } = freshUser()
    await createTune(db, { title: 'X' }, { status: 'known' })
    writeSearchQuery('catalog', 'X')
    writeSearchQuery('recordings', 'jig')
    const sync = vi.fn(async () => {
      await db.outbox.clear()
    })
    const stop = vi.fn()
    const signOut = vi.fn(async () => {
      expect(await Dexie.exists(databaseName(userId))).toBe(true)
    })
    await signOutAndForget({ db, userId, engine: fakeEngine({ sync, stop }), signOut })
    expect(sync.mock.invocationCallOrder[0]).toBeLessThan(stop.mock.invocationCallOrder[0]!)
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]!)
    expect(await Dexie.exists(databaseName(userId))).toBe(false)
    expect(rememberedUser()).toBeNull()
    expect(readSearchQuery('catalog')).toBe('')
    expect(readSearchQuery('recordings')).toBe('')
  })

  it('refuses while edits are still queued so the deletion cannot take them', async () => {
    const { userId, db } = freshUser()
    await createTune(db, { title: 'X' }, { status: 'known' })
    const stop = vi.fn()
    const signOut = vi.fn(async () => {})
    await expect(
      signOutAndForget({ db, userId, engine: fakeEngine({ stop }), signOut }),
    ).rejects.toThrow('have not synced')
    expect(stop).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    expect(await db.tunes.count()).toBe(1)
    expect(rememberedUser()).toBe(userId)
    await db.delete()
  })

  it('refuses while a recording has not uploaded so the deletion cannot take it', async () => {
    const { userId, db } = freshUser()
    const id = await addUploadedFile(db, new File(['abc'], 'jam.m4a', { type: 'audio/mp4' }), {
      tuneId: null,
      label: null,
      durationMs: null,
    })
    await setFileState(db, id, 'blocked_quota')
    await db.outbox.clear()
    const stop = vi.fn()
    const signOut = vi.fn(async () => {})
    await expect(
      signOutAndForget({ db, userId, engine: fakeEngine({ stop }), signOut }),
    ).rejects.toThrow(UNSYNCED_RECORDINGS_ERROR)
    expect(stop).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    expect(await Dexie.exists(databaseName(userId))).toBe(true)
    expect(await db.recording_files.count()).toBe(1)
    await db.delete()
  })

  it('refuses sign-out while a captured page is not uploaded', async () => {
    const { userId, db } = freshUser()
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const [pageId] = await addNotationPages(db, tuneId, [
      { blob: new Blob(['jpeg']), width: 10, height: 20 },
    ])
    await db.outbox.clear()
    const stop = vi.fn()
    const signOut = vi.fn(async () => {})
    await expect(
      signOutAndForget({ db, userId, engine: fakeEngine({ stop }), signOut }),
    ).rejects.toThrow(UNSYNCED_NOTATION_ERROR)
    expect(stop).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    expect(await db.notation_files.count()).toBe(1)

    // Once uploaded, the file is only a cache of what the server holds.
    await db.notation_files.update(pageId!, { origin: 'downloaded' })
    await signOutAndForget({ db, userId, engine: fakeEngine({ stop }), signOut })
    expect(signOut).toHaveBeenCalledOnce()
    expect(await Dexie.exists(databaseName(userId))).toBe(false)
  })

  it('signs out past a captured page whose tune was deleted on another device', async () => {
    const { userId, db } = freshUser()
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    await addNotationPages(db, tuneId, [{ blob: new Blob(['jpeg']), width: 10, height: 20 }])
    await db.outbox.clear()
    const deletedAt = '2026-10-03T21:00:00.000Z'
    await applyPullPage(
      db,
      [
        {
          table: 'tunes',
          row: serverTune({ id: tuneId, deleted_at: deletedAt, updated_at: deletedAt }),
        },
      ],
      10,
    )
    const signOut = vi.fn(async () => {})
    await signOutAndForget({ db, userId, engine: fakeEngine({}), signOut })
    expect(signOut).toHaveBeenCalledOnce()
    expect(await Dexie.exists(databaseName(userId))).toBe(false)
  })

  it('keeps the catalog and resumes sync when Clerk sign-out fails', async () => {
    const { userId, db } = freshUser()
    await createTune(db, { title: 'X' }, { status: 'known' })
    await db.outbox.clear()
    const resume = vi.fn()
    const signOut = vi.fn(async () => {
      throw new Error('Clerk unreachable')
    })
    await expect(
      signOutAndForget({ db, userId, engine: fakeEngine({ resume }), signOut }),
    ).rejects.toThrow('Clerk unreachable')
    expect(resume).toHaveBeenCalledOnce()
    expect(await db.tunes.count()).toBe(1)
    expect(rememberedUser()).toBe(userId)
    await db.delete()
  })
})
