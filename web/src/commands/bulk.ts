import type { CrosstuneDb } from '../db/schema'
import type { LocalListItem, LocalSong, LocalUserSong } from '../db/types'
import { activeItems, createList, deleteList, writeOrder } from './lists'
import { LIST_NOT_FOUND, SONG_NOT_FOUND, SONG_NOT_IN_LIST } from './messages'
import { tombstoneSong, type SongInput, type UserSongInput } from './songs'
import { newId, nextPosition, now, putRow, recordingTx, tombstone, writeTx } from './write'

export type Undo = () => Promise<void>

/** Fields that describe many songs at once; per-song text such as titles and notes is left out. */
export interface BulkPatch {
  song?: Partial<Omit<SongInput, 'title' | 'alternate_titles'>>
  userSong?: Partial<Omit<UserSongInput, 'notes'>>
}

type Fields = Record<string, unknown>

/** The previous values of the fields a bulk write changed on one row. */
export interface Snapshot {
  table: 'songs' | 'user_songs'
  id: string
  before: Fields
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

/** The patch entries that would change the row, skipping undefined, which means keep. */
function changes(row: object, patch: Fields): Fields {
  const current = row as Fields
  return Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => value !== undefined && current[key] !== value),
  )
}

function previous(row: object, changed: Fields): Fields {
  const current = row as Fields
  return Object.fromEntries(Object.keys(changed).map((key) => [key, current[key]]))
}

/**
 * Write back each snapshot's fields onto the row as it is now, so edits made to other
 * fields since the bulk write survive. A row deleted since is skipped.
 */
export async function restoreFields(
  db: CrosstuneDb,
  snapshots: readonly Snapshot[],
): Promise<void> {
  if (snapshots.length === 0) return
  await writeTx(db, async () => {
    const at = now()
    for (const { table, id, before } of snapshots) {
      if (table === 'songs') {
        const row = await db.songs.get(id)
        if (!row || row.deleted_at) continue
        await putRow(db, 'songs', { ...row, ...(before as Partial<LocalSong>), updated_at: at })
      } else {
        const row = await db.user_songs.get(id)
        if (!row || row.deleted_at) continue
        await putRow(db, 'user_songs', {
          ...row,
          ...(before as Partial<LocalUserSong>),
          updated_at: at,
        })
      }
    }
  })
}

export async function updateSongs(
  db: CrosstuneDb,
  userSongIds: readonly string[],
  patch: BulkPatch,
): Promise<Undo> {
  const songPatch = (patch.song ?? {}) as Fields
  const userSongPatch = (patch.userSong ?? {}) as Fields
  const snapshots: Snapshot[] = []
  await writeTx(db, async () => {
    const at = now()
    for (const userSongId of unique(userSongIds)) {
      const userSong = await db.user_songs.get(userSongId)
      if (!userSong || userSong.deleted_at) throw new Error(SONG_NOT_FOUND)
      const song = await db.songs.get(userSong.song_id)
      if (!song || song.deleted_at) throw new Error(SONG_NOT_FOUND)

      const songChanges = changes(song, songPatch)
      if (Object.keys(songChanges).length > 0) {
        snapshots.push({ table: 'songs', id: song.id, before: previous(song, songChanges) })
        await putRow(db, 'songs', {
          ...song,
          ...(songChanges as Partial<LocalSong>),
          updated_at: at,
        })
      }

      const userSongChanges = changes(userSong, userSongPatch)
      if (Object.keys(userSongChanges).length > 0) {
        snapshots.push({
          table: 'user_songs',
          id: userSong.id,
          before: previous(userSong, userSongChanges),
        })
        await putRow(db, 'user_songs', {
          ...userSong,
          ...(userSongChanges as Partial<LocalUserSong>),
          updated_at: at,
        })
      }
    }
  })
  return () => restoreFields(db, snapshots)
}

export async function setArchivedMany(
  db: CrosstuneDb,
  userSongIds: readonly string[],
  archived: boolean,
): Promise<Undo> {
  const snapshots: Snapshot[] = []
  await writeTx(db, async () => {
    const at = now()
    for (const id of unique(userSongIds)) {
      const userSong = await db.user_songs.get(id)
      if (!userSong || userSong.deleted_at) throw new Error(SONG_NOT_FOUND)
      if ((userSong.archived_at !== null) === archived) continue
      snapshots.push({ table: 'user_songs', id, before: { archived_at: userSong.archived_at } })
      await putRow(db, 'user_songs', {
        ...userSong,
        archived_at: archived ? at : null,
        updated_at: at,
      })
    }
  })
  return () => restoreFields(db, snapshots)
}

/**
 * Delete the songs behind the given user songs, each with its links, list entries, and
 * recordings. There is no undo: a recording this takes with it is gone from every device.
 */
export async function deleteSongs(
  db: CrosstuneDb,
  userSongIds: readonly string[],
): Promise<number> {
  return recordingTx(db, async () => {
    const at = now()
    const songIds = new Set<string>()
    for (const id of unique(userSongIds)) {
      const userSong = await db.user_songs.get(id)
      if (!userSong || userSong.deleted_at) throw new Error(SONG_NOT_FOUND)
      songIds.add(userSong.song_id)
    }
    for (const songId of songIds) await tombstoneSong(db, songId, at)
    return songIds.size
  })
}

export async function addSongsToList(
  db: CrosstuneDb,
  listId: string,
  userSongIds: readonly string[],
): Promise<{ undo: Undo; added: number }> {
  const created: string[] = []
  await writeTx(db, async () => {
    const list = await db.lists.get(listId)
    if (!list || list.deleted_at) throw new Error(LIST_NOT_FOUND)
    const items = await activeItems(db, listId)
    const members = new Set(items.map((item) => item.user_song_id))
    let position = nextPosition(items)
    const at = now()
    for (const userSongId of unique(userSongIds)) {
      if (members.has(userSongId)) continue
      const userSong = await db.user_songs.get(userSongId)
      if (!userSong || userSong.deleted_at) throw new Error(SONG_NOT_FOUND)
      const id = newId()
      await putRow(db, 'list_items', {
        id,
        created_at: at,
        updated_at: at,
        deleted_at: null,
        server_seq: 0,
        list_id: listId,
        user_song_id: userSongId,
        position,
      })
      position += 1
      members.add(userSongId)
      created.push(id)
    }
  })
  return {
    added: created.length,
    undo: async () => {
      if (created.length === 0) return
      await writeTx(db, async () => {
        const at = now()
        for (const id of created) await tombstone(db, 'list_items', id, at)
      })
    },
  }
}

export async function createListWithSongs(
  db: CrosstuneDb,
  name: string,
  userSongIds: readonly string[],
): Promise<Undo> {
  const listId = await writeTx(db, async () => {
    const id = await createList(db, name)
    await addSongsToList(db, id, userSongIds)
    return id
  })
  return () => deleteList(db, listId)
}

export async function removeSongsFromList(
  db: CrosstuneDb,
  itemIds: readonly string[],
): Promise<Undo> {
  const removed: string[] = []
  await writeTx(db, async () => {
    const at = now()
    for (const id of unique(itemIds)) {
      const item = await db.list_items.get(id)
      if (!item || item.deleted_at) throw new Error(SONG_NOT_IN_LIST)
      await tombstone(db, 'list_items', id, at)
      removed.push(id)
    }
  })
  return async () => {
    if (removed.length === 0) return
    await writeTx(db, async () => {
      const at = now()
      const restorable: LocalListItem[] = []
      for (const id of removed) {
        const item = await db.list_items.get(id)
        if (!item || !item.deleted_at) continue
        const list = await db.lists.get(item.list_id)
        const userSong = await db.user_songs.get(item.user_song_id)
        if (!list || list.deleted_at || !userSong || userSong.deleted_at) continue
        restorable.push(item)
      }
      const byList = new Map<string, LocalListItem[]>()
      for (const item of restorable) {
        const items = byList.get(item.list_id) ?? []
        items.push(item)
        byList.set(item.list_id, items)
      }
      for (const [listId, items] of byList) {
        const active = await activeItems(db, listId)
        const members = new Set(active.map((member) => member.user_song_id))
        const toRestore = items.filter((item) => !members.has(item.user_song_id))
        if (toRestore.length === 0) continue
        const restored = toRestore.map((item) => ({ ...item, deleted_at: null, updated_at: at }))
        const restoredIds = new Set(restored.map((item) => item.id))
        for (const item of restored) await putRow(db, 'list_items', item)
        // The freed position may already be reused by another item, so restored
        // rows compete for their old slot: a restored item held it first.
        const merged = [...active, ...restored].sort((a, b) => {
          if (a.position !== b.position) return a.position - b.position
          return Number(restoredIds.has(b.id)) - Number(restoredIds.has(a.id))
        })
        await writeOrder(db, merged)
      }
    })
  }
}
