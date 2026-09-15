import { useLiveQuery } from 'dexie-react-hooks'
import {
  activeRecordingsForSong,
  setListKeepOffline,
  setSongKeepOffline,
  songIdsInList,
} from '../../commands/recordings'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { getKeepOfflineLists, getKeepOfflineSongs } from '../../db/meta'
import { useSyncEngine } from '../../sync/SyncProvider'

interface KeepOfflineState {
  marked: boolean
  /** Live recordings the toggle covers; zero means there is nothing to keep offline. */
  count: number
}

/** Marks a song, or every song in a list, to keep its recordings downloaded ahead of a jam.
 * The mark itself is what is shown and toggled here, independent of which file rows already
 * hold a blob: downloadPass is what catches those rows up afterward. */
export function KeepOfflineToggle({ songId, listId }: { songId?: string; listId?: string }) {
  const db = useDb()
  const engine = useSyncEngine()
  const { run } = useAction()
  const state = useLiveQuery<KeepOfflineState>(async () => {
    if (songId) {
      const marks = await getKeepOfflineSongs(db)
      const rows = await activeRecordingsForSong(db, songId)
      return { marked: marks.includes(songId), count: rows.length }
    }
    if (listId) {
      const marks = await getKeepOfflineLists(db)
      const songIds = await songIdsInList(db, listId)
      const count = await db.recordings
        .where('song_id')
        .anyOf([...songIds])
        .filter((r) => !r.deleted_at)
        .count()
      return { marked: marks.includes(listId), count }
    }
    return { marked: false, count: 0 }
  }, [db, songId, listId])
  const loading = state === undefined
  const empty = !loading && state.count === 0
  const disabled = loading || empty
  return (
    <label className="label min-h-11 cursor-pointer gap-2">
      <input
        type="checkbox"
        className="toggle"
        aria-label="Keep offline"
        aria-disabled={disabled ? true : undefined}
        checked={!loading && state.marked}
        onChange={(e) => {
          if (disabled) return
          const on = e.target.checked
          run(async () => {
            if (songId) await setSongKeepOffline(db, songId, on)
            else if (listId) await setListKeepOffline(db, listId, on)
            if (on) {
              void engine.sync()
              // Asked only once there is something worth protecting from storage eviction.
              void navigator.storage?.persist?.().catch(() => {})
            }
          })
        }}
      />
      Keep offline
      {empty ? <span className="text-xs opacity-70">No recordings yet</span> : null}
    </label>
  )
}
