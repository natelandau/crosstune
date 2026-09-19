import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { recordingFile, recordingRow } from '../test/rows'
import {
  addSongsToList,
  createListWithSongs,
  deleteSongs,
  removeSongsFromList,
  setArchivedMany,
  updateSongs,
} from './bulk'
import { activeItems, addToList, createList, moveItem, removeFromList } from './lists'
import { createSong, deleteSong, setArchived, updateSong } from './songs'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

async function song(title: string, extra: Parameters<typeof createSong>[1] = { title }) {
  return createSong(db, { ...extra, title }, { status: 'learning' })
}

describe('updateSongs', () => {
  it('writes song and user song fields on every selected song', async () => {
    const a = await song('Say Old Man', { title: '', key: 'A' })
    const b = await song('Lost Indian', { title: '', key: 'A', genre: 'Old-time' })
    await updateSongs(db, [a.userSongId, b.userSongId], {
      song: { violin_tuning: 'Cross A (AEAE)', genre: null },
      userSong: { status: 'known' },
    })
    for (const { songId, userSongId } of [a, b]) {
      expect(await db.songs.get(songId)).toMatchObject({
        violin_tuning: 'Cross A (AEAE)',
        genre: null,
        key: 'A',
      })
      expect((await db.user_songs.get(userSongId))?.status).toBe('known')
    }
  })

  it('writes nothing when one song is missing', async () => {
    const a = await song('Say Old Man')
    const b = await song('Lost Indian')
    await deleteSong(db, b.songId)
    await expect(
      updateSongs(db, [a.userSongId, b.userSongId], { userSong: { status: 'known' } }),
    ).rejects.toThrow('Song not found')
    expect((await db.user_songs.get(a.userSongId))?.status).toBe('learning')
  })

  it('leaves a row alone when it already matches the patch', async () => {
    const a = await song('Say Old Man', { title: '', key: 'A' })
    await db.outbox.clear()
    const before = await db.songs.get(a.songId)
    await updateSongs(db, [a.userSongId], { song: { key: 'A' } })
    expect(await db.songs.get(a.songId)).toEqual(before)
    expect(await pendingFor(db, 'songs', a.songId)).toBeUndefined()
    expect(await pendingFor(db, 'user_songs', a.userSongId)).toBeUndefined()
  })

  it('keeps a field the patch leaves undefined', async () => {
    const a = await song('Say Old Man', { title: '', key: 'A', genre: 'Old-time' })
    await updateSongs(db, [a.userSongId], { song: { key: 'D', genre: undefined } })
    expect(await db.songs.get(a.songId)).toMatchObject({ key: 'D', genre: 'Old-time' })
  })

  it('undoes only the fields it changed, keeping an edit made since', async () => {
    const a = await song('Say Old Man', { title: '', key: 'A', violin_tuning: 'Standard (GDAE)' })
    const undo = await updateSongs(db, [a.userSongId], {
      song: { violin_tuning: 'Cross A (AEAE)' },
      userSong: { status: 'known' },
    })
    await updateSong(db, a.songId, { key: 'G' })
    await undo()
    expect(await db.songs.get(a.songId)).toMatchObject({
      violin_tuning: 'Standard (GDAE)',
      key: 'G',
    })
    expect((await db.user_songs.get(a.userSongId))?.status).toBe('learning')
    expect(await pendingFor(db, 'songs', a.songId)).toMatchObject({ op: 'upsert' })
  })

  it('undo gives the restored row a fresh updated_at', async () => {
    const a = await song('Say Old Man')
    const undo = await updateSongs(db, [a.userSongId], { song: { key: 'A' } })
    const changed = (await db.songs.get(a.songId))!.updated_at
    vi.setSystemTime(new Date(Date.parse(changed) + 1000))
    await undo()
    vi.useRealTimers()
    expect(Date.parse((await db.songs.get(a.songId))!.updated_at)).toBeGreaterThan(
      Date.parse(changed),
    )
  })

  it('undo skips a song deleted since', async () => {
    const a = await song('Say Old Man')
    const b = await song('Lost Indian')
    const undo = await updateSongs(db, [a.userSongId, b.userSongId], { song: { key: 'A' } })
    await deleteSong(db, b.songId)
    await undo()
    expect((await db.songs.get(a.songId))?.key).toBeNull()
    expect((await db.songs.get(b.songId))?.deleted_at).not.toBeNull()
  })
})

describe('setArchivedMany', () => {
  it('archives the selected songs and undo restores each one', async () => {
    const a = await song('Say Old Man')
    const b = await song('Lost Indian')
    await setArchived(db, b.userSongId, true)
    const archivedAt = (await db.user_songs.get(b.userSongId))!.archived_at
    const undo = await setArchivedMany(db, [a.userSongId, b.userSongId], true)
    expect((await db.user_songs.get(a.userSongId))?.archived_at).not.toBeNull()
    expect((await db.user_songs.get(b.userSongId))?.archived_at).toBe(archivedAt)
    await undo()
    expect((await db.user_songs.get(a.userSongId))?.archived_at).toBeNull()
    expect((await db.user_songs.get(b.userSongId))?.archived_at).toBe(archivedAt)
  })

  it('unarchives, and undo archives again with the old timestamp', async () => {
    const a = await song('Say Old Man')
    await setArchived(db, a.userSongId, true)
    const archivedAt = (await db.user_songs.get(a.userSongId))!.archived_at
    const undo = await setArchivedMany(db, [a.userSongId], false)
    expect((await db.user_songs.get(a.userSongId))?.archived_at).toBeNull()
    await undo()
    expect((await db.user_songs.get(a.userSongId))?.archived_at).toBe(archivedAt)
  })
})

describe('deleteSongs', () => {
  it('tombstones each selected song with its user song, list entries, and recordings', async () => {
    const a = await song('Say Old Man')
    const b = await song('Lost Indian')
    const kept = await song('Ducks on the Millpond')
    const listId = await createList(db, 'Tuesday jam')
    await addToList(db, listId, a.userSongId)
    await db.recordings.put(recordingRow('r1', { song_id: a.songId }))
    await db.recording_files.put(recordingFile('r1'))

    expect(await deleteSongs(db, [a.userSongId, b.userSongId])).toBe(2)
    expect((await db.songs.get(a.songId))?.deleted_at).not.toBeNull()
    expect((await db.user_songs.get(a.userSongId))?.deleted_at).not.toBeNull()
    expect((await db.songs.get(b.songId))?.deleted_at).not.toBeNull()
    expect((await db.songs.get(kept.songId))?.deleted_at).toBeNull()
    expect(await activeItems(db, listId)).toEqual([])
    expect((await db.recordings.get('r1'))?.deleted_at).not.toBeNull()
    expect(await db.recording_files.get('r1')).toBeUndefined()
  })

  it('queues one delete per song and none for the rows that go with it', async () => {
    const a = await song('Say Old Man')
    await deleteSongs(db, [a.userSongId])
    expect(await pendingFor(db, 'songs', a.songId)).toMatchObject({ op: 'delete' })
    expect(await pendingFor(db, 'user_songs', a.userSongId)).toBeUndefined()
  })

  it('counts two selected user songs of one song once', async () => {
    const a = await song('Say Old Man')
    expect(await deleteSongs(db, [a.userSongId, a.userSongId])).toBe(1)
  })

  it('rejects when a selected song is already gone', async () => {
    const a = await song('Say Old Man')
    await deleteSong(db, a.songId)
    await expect(deleteSongs(db, [a.userSongId])).rejects.toThrow('Song not found')
  })
})

describe('addSongsToList', () => {
  it('appends missing songs in the given order and skips members', async () => {
    const a = await song('A')
    const b = await song('B')
    const c = await song('C')
    const listId = await createList(db, 'Tuesday jam')
    await addToList(db, listId, b.userSongId)
    const { added } = await addSongsToList(db, listId, [c.userSongId, b.userSongId, a.userSongId])
    expect(added).toBe(2)
    expect((await activeItems(db, listId)).map((i) => i.user_song_id)).toEqual([
      b.userSongId,
      c.userSongId,
      a.userSongId,
    ])
  })

  it('undo removes only the items it added', async () => {
    const a = await song('A')
    const b = await song('B')
    const listId = await createList(db, 'Tuesday jam')
    await addToList(db, listId, a.userSongId)
    const { undo } = await addSongsToList(db, listId, [a.userSongId, b.userSongId])
    await undo()
    expect((await activeItems(db, listId)).map((i) => i.user_song_id)).toEqual([a.userSongId])
  })

  it('writes nothing when the list is gone', async () => {
    const a = await song('A')
    await expect(addSongsToList(db, 'missing', [a.userSongId])).rejects.toThrow('List not found')
  })
})

describe('createListWithSongs', () => {
  it('creates a list holding the songs, and undo deletes it', async () => {
    const a = await song('A')
    const b = await song('B')
    const undo = await createListWithSongs(db, '  Clifftop  ', [a.userSongId, b.userSongId])
    const list = (await db.lists.toArray()).find((l) => !l.deleted_at)!
    expect(list.name).toBe('Clifftop')
    expect((await activeItems(db, list.id)).map((i) => i.user_song_id)).toEqual([
      a.userSongId,
      b.userSongId,
    ])
    await undo()
    expect((await db.lists.get(list.id))?.deleted_at).not.toBeNull()
  })

  it('rejects a blank name and writes nothing', async () => {
    const a = await song('A')
    await expect(createListWithSongs(db, ' ', [a.userSongId])).rejects.toThrow(
      'A list needs a name',
    )
    expect(await db.lists.count()).toBe(0)
  })

  it('writes nothing when a song is missing', async () => {
    const a = await song('A')
    await expect(createListWithSongs(db, 'Tuesday jam', [a.userSongId, 'missing'])).rejects.toThrow(
      'Song not found',
    )
    expect((await db.lists.toArray()).some((l) => !l.deleted_at)).toBe(false)
    expect(await db.list_items.count()).toBe(0)
  })
})

describe('removeSongsFromList', () => {
  it('removes the items, and undo puts them back in their places', async () => {
    const a = await song('A')
    const b = await song('B')
    const c = await song('C')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userSongId)
    const ib = await addToList(db, listId, b.userSongId)
    const ic = await addToList(db, listId, c.userSongId)
    const undo = await removeSongsFromList(db, [ia, ic])
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ib])
    await undo()
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia, ib, ic])
    expect(await pendingFor(db, 'list_items', ia)).toMatchObject({ op: 'upsert' })
  })

  it('undo does not duplicate a song added back to the list since', async () => {
    const a = await song('A')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userSongId)
    const undo = await removeSongsFromList(db, [ia])
    await addToList(db, listId, a.userSongId)
    await undo()
    expect((await activeItems(db, listId)).map((i) => i.user_song_id)).toEqual([a.userSongId])
  })

  it('undo skips a song deleted since', async () => {
    const a = await song('A')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userSongId)
    const undo = await removeSongsFromList(db, [ia])
    await deleteSong(db, a.songId)
    await undo()
    expect(await activeItems(db, listId)).toEqual([])
  })

  it('writes nothing when an item is already removed', async () => {
    const a = await song('A')
    const b = await song('B')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userSongId)
    const ib = await addToList(db, listId, b.userSongId)
    await removeFromList(db, ib)
    await expect(removeSongsFromList(db, [ia, ib])).rejects.toThrow('Song not found in list')
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia])
  })

  it('undo keeps positions distinct when another song took the freed slot', async () => {
    const a = await song('A')
    const b = await song('B')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userSongId)
    const undo = await removeSongsFromList(db, [ia])
    const ib = await addToList(db, listId, b.userSongId)
    await undo()
    const items = await activeItems(db, listId)
    expect(items.map((i) => i.id)).toEqual([ia, ib])
    expect(items.map((i) => i.position)).toEqual([0, 1])
  })

  it('undo keeps a restored item when the list has a position gap', async () => {
    const a = await song('A')
    const b = await song('B')
    const c = await song('C')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userSongId)
    const ib = await addToList(db, listId, b.userSongId)
    const ic = await addToList(db, listId, c.userSongId)
    await removeFromList(db, ia)
    const undo = await removeSongsFromList(db, [ic])
    await undo()
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ib, ic])
    expect((await db.list_items.get(ic))?.deleted_at).toBeNull()
  })

  it('undo restores the order after a reorder in between', async () => {
    const a = await song('A')
    const b = await song('B')
    const c = await song('C')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userSongId)
    const ib = await addToList(db, listId, b.userSongId)
    const ic = await addToList(db, listId, c.userSongId)
    const undo = await removeSongsFromList(db, [ib])
    await moveItem(db, listId, ic, ia)
    await undo()
    const items = await activeItems(db, listId)
    // B's old slot went to A once C moved ahead of it, so B restores ahead of A.
    expect(items.map((i) => i.id)).toEqual([ic, ib, ia])
    expect(items.map((i) => i.position)).toEqual([0, 1, 2])
  })
})
