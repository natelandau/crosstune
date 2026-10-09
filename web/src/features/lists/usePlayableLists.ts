import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { useOnline } from '../../sync/SyncProvider'
import { playlistReport } from '../player/listSource'
import { readPlaylists } from '../player/readPlaylist'

/** The ids of the lists with a tune that would play now, kept live; undefined until read. */
export function usePlayableLists(): ReadonlySet<string> | undefined {
  const db = useDb()
  const online = useOnline()
  const playlists = useLiveQuery(() => readPlaylists(db), [db])
  if (!playlists) return undefined
  const playable = new Set<string>()
  for (const [listId, playlist] of playlists) {
    const report = playlistReport(playlist.entries, {
      online,
      hasAudio: (id) => playlist.held.has(id),
    })
    if (report.playable.length > 0) playable.add(listId)
  }
  return playable
}
