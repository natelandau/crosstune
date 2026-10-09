import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { useDb } from '../../db/DbProvider'
import { useOnline } from '../../sync/SyncProvider'
import { playlistReport } from '../player/listSource'
import { playlistAvailability, readPlaylists } from '../player/readPlaylist'

/** The ids of the lists with a tune that would play now, kept live; undefined until read. */
export function usePlayableLists(): ReadonlySet<string> | undefined {
  const db = useDb()
  const online = useOnline()
  const playlists = useLiveQuery(() => readPlaylists(db), [db])
  return useMemo(() => {
    if (!playlists) return undefined
    const playable = new Set<string>()
    for (const [listId, playlist] of playlists) {
      const report = playlistReport(playlist.entries, playlistAvailability(playlist, online))
      if (report.playable.length > 0) playable.add(listId)
    }
    return playable
  }, [playlists, online])
}
