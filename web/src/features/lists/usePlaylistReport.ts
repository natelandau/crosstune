import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { useOnline } from '../../sync/SyncProvider'
import { playlistReport, type PlaylistReport } from '../player/listSource'
import { playlistEntries, readPlaylistMedia } from '../player/readPlaylist'
import type { ListItemView } from './useLists'

/**
 * What a list's shown rows would play now, kept live; undefined until the tunes' sources have
 * read. Each row counts, so a tune listed twice counts twice here but once in the queue.
 */
export function usePlaylistReport(rows: readonly ListItemView[]): PlaylistReport | undefined {
  const db = useDb()
  const online = useOnline()
  // Keyed by the set of tunes, since the caller builds its rows afresh each render and a
  // reorder changes nothing to read.
  const key = [...new Set(rows.map((row) => row.tune.id))].sort().join(' ')
  const media = useLiveQuery(() => readPlaylistMedia(db, key ? key.split(' ') : []), [db, key])
  if (!media) return undefined
  return playlistReport(playlistEntries(rows, media), {
    online,
    hasAudio: (id) => media.held.has(id),
  })
}
