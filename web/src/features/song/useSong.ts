import { useLiveQuery } from 'dexie-react-hooks'
import { activeByPosition } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLink, LocalSong, LocalUserSong } from '../../db/types'

export interface SongView {
  song: LocalSong
  userSong: LocalUserSong
  links: LocalRecordingLink[]
}

export function useSong(songId: string): SongView | null | undefined {
  const db = useDb()
  return useLiveQuery(async (): Promise<SongView | null> => {
    const song = await db.songs.get(songId)
    if (!song || song.deleted_at) return null
    const userSong = (await db.user_songs.where('song_id').equals(songId).toArray()).find(
      (u) => !u.deleted_at,
    )
    if (!userSong) return null
    const links = activeByPosition(
      await db.recording_links.where('song_id').equals(songId).toArray(),
    )
    return { song, userSong, links }
  }, [db, songId])
}
