import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { rememberedUser, rememberUser } from '../../auth/session'
import { addUploadedFile, setFileState } from '../../commands/recordings'
import { createSong } from '../../commands/songs'
import { databaseName, openDatabase } from '../../db/schema'
import { readSearchQuery, writeSearchQuery } from '../catalog/searchSession'
import { fakeEngine } from '../../test/providers'
import { signOutAndForget } from './signOut'

function freshUser() {
  const userId = `user_${crypto.randomUUID()}`
  rememberUser(userId)
  return { userId, db: openDatabase(userId) }
}

describe('signOutAndForget', () => {
  it('flushes the outbox, stops sync, signs out of Clerk, then deletes the local database', async () => {
    const { userId, db } = freshUser()
    await createSong(db, { title: 'X' }, { status: 'known' })
    writeSearchQuery('X')
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
    expect(readSearchQuery()).toBe('')
  })

  it('refuses while edits are still queued so the deletion cannot take them', async () => {
    const { userId, db } = freshUser()
    await createSong(db, { title: 'X' }, { status: 'known' })
    const stop = vi.fn()
    const signOut = vi.fn(async () => {})
    await expect(
      signOutAndForget({ db, userId, engine: fakeEngine({ stop }), signOut }),
    ).rejects.toThrow('have not synced')
    expect(stop).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    expect(await db.songs.count()).toBe(1)
    expect(rememberedUser()).toBe(userId)
    await db.delete()
  })

  it('refuses while a recording has not uploaded so the deletion cannot take it', async () => {
    const { userId, db } = freshUser()
    const id = await addUploadedFile(db, new File(['abc'], 'jam.m4a', { type: 'audio/mp4' }), {
      songId: null,
      label: null,
    })
    await setFileState(db, id, 'blocked_quota')
    await db.outbox.clear()
    const stop = vi.fn()
    const signOut = vi.fn(async () => {})
    await expect(
      signOutAndForget({ db, userId, engine: fakeEngine({ stop }), signOut }),
    ).rejects.toThrow(
      'Some recordings have not uploaded yet. Delete them in Recordings, or wait until they upload.',
    )
    expect(stop).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    expect(await Dexie.exists(databaseName(userId))).toBe(true)
    expect(await db.recording_files.count()).toBe(1)
    await db.delete()
  })

  it('keeps the catalog and resumes sync when Clerk sign-out fails', async () => {
    const { userId, db } = freshUser()
    await createSong(db, { title: 'X' }, { status: 'known' })
    await db.outbox.clear()
    const resume = vi.fn()
    const signOut = vi.fn(async () => {
      throw new Error('Clerk unreachable')
    })
    await expect(
      signOutAndForget({ db, userId, engine: fakeEngine({ resume }), signOut }),
    ).rejects.toThrow('Clerk unreachable')
    expect(resume).toHaveBeenCalledOnce()
    expect(await db.songs.count()).toBe(1)
    expect(rememberedUser()).toBe(userId)
    await db.delete()
  })
})
