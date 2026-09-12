import type { CrosstuneDb } from '../db/schema'
import type { Mode, SongStatus, TimeSignature } from '../db/types'
import { defined, newId, now, putRow, tombstone, writeTx } from './write'

export interface SongInput {
  title: string
  alternate_titles?: string[]
  genre?: string | null
  feel?: string | null
  has_lyrics?: boolean | null
  key?: string | null
  mode?: Mode | null
  tuning?: string | null
  part_structure?: string | null
  time_signature?: TimeSignature | null
  is_crooked?: boolean
}

export interface UserSongInput {
  status: SongStatus
  learned_from?: string | null
  learned_on?: string | null
  notes?: string | null
}

export async function createSong(
  db: CrosstuneDb,
  song: SongInput,
  userSong: UserSongInput,
): Promise<{ songId: string; userSongId: string }> {
  const title = song.title.trim()
  if (!title) throw new Error('A song needs a title')
  const at = now()
  const songId = newId()
  const userSongId = newId()
  await writeTx(db, async () => {
    await putRow(db, 'songs', {
      id: songId,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      title,
      alternate_titles: song.alternate_titles ?? [],
      genre: song.genre ?? null,
      feel: song.feel ?? null,
      has_lyrics: song.has_lyrics ?? null,
      key: song.key ?? null,
      mode: song.mode ?? null,
      tuning: song.tuning ?? null,
      part_structure: song.part_structure ?? null,
      time_signature: song.time_signature ?? null,
      is_crooked: song.is_crooked ?? false,
    })
    await putRow(db, 'user_songs', {
      id: userSongId,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      song_id: songId,
      status: userSong.status,
      learned_from: userSong.learned_from ?? null,
      learned_on: userSong.learned_on ?? null,
      notes: userSong.notes ?? null,
      archived_at: null,
    })
  })
  return { songId, userSongId }
}

export async function updateSong(
  db: CrosstuneDb,
  songId: string,
  patch: Partial<SongInput>,
): Promise<void> {
  const changes = defined(patch)
  if (changes.title !== undefined) {
    changes.title = changes.title.trim()
    if (!changes.title) throw new Error('A song needs a title')
  }
  await writeTx(db, async () => {
    const song = await db.songs.get(songId)
    if (!song || song.deleted_at) throw new Error('Song not found')
    await putRow(db, 'songs', { ...song, ...changes, updated_at: now() })
  })
}

export async function updateUserSong(
  db: CrosstuneDb,
  userSongId: string,
  patch: Partial<UserSongInput>,
): Promise<void> {
  const changes = defined(patch)
  await writeTx(db, async () => {
    const userSong = await db.user_songs.get(userSongId)
    if (!userSong || userSong.deleted_at) throw new Error('Song not found')
    await putRow(db, 'user_songs', { ...userSong, ...changes, updated_at: now() })
  })
}

export async function setArchived(
  db: CrosstuneDb,
  userSongId: string,
  archived: boolean,
): Promise<void> {
  const at = now()
  await writeTx(db, async () => {
    const userSong = await db.user_songs.get(userSongId)
    if (!userSong || userSong.deleted_at) throw new Error('Song not found')
    await putRow(db, 'user_songs', {
      ...userSong,
      archived_at: archived ? at : null,
      updated_at: at,
    })
  })
}

export async function deleteSong(db: CrosstuneDb, songId: string): Promise<void> {
  const at = now()
  await writeTx(db, async () => {
    await tombstone(db, 'songs', songId, at)
    const userSongs = await db.user_songs.where('song_id').equals(songId).toArray()
    for (const userSong of userSongs) {
      const items = await db.list_items.where('user_song_id').equals(userSong.id).toArray()
      for (const item of items) {
        await tombstone(db, 'list_items', item.id, at, { enqueueDelete: false })
      }
      await tombstone(db, 'user_songs', userSong.id, at, { enqueueDelete: false })
    }
    const links = await db.recording_links.where('song_id').equals(songId).toArray()
    for (const link of links) {
      await tombstone(db, 'recording_links', link.id, at, { enqueueDelete: false })
    }
  })
}
