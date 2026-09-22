import { useLiveQuery } from 'dexie-react-hooks'
import { activeRecordingsForSong } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording, LocalSong } from '../../db/types'

export interface RecordingView {
  recording: LocalRecording
  file: RecordingFile | undefined
  /** The recording's song, when it still exists; null files a recording as unfiled
   * even if `recording.song_id` still points at a song deleted elsewhere. */
  songId: string | null
  songTitle: string | null
}

/** Live recordings with their local file, newest first, unfiled ones first. */
export function useRecordingsWithFiles({ songId }: { songId?: string } = {}):
  RecordingView[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const live = songId
      ? await activeRecordingsForSong(db, songId)
      : (await db.recordings.toArray()).filter((r) => !r.deleted_at)
    const files = await db.recording_files.bulkGet(live.map((r) => r.id))
    const wantedSongIds = [...new Set(live.map((r) => r.song_id).filter((s): s is string => !!s))]
    const songs = await db.songs.bulkGet(wantedSongIds)
    const liveSongs = new Map(
      songs.filter((s): s is LocalSong => !!s && !s.deleted_at).map((s) => [s.id, s] as const),
    )
    const views = live.map((recording, i) => {
      const song = recording.song_id ? liveSongs.get(recording.song_id) : undefined
      return {
        recording,
        file: files[i],
        songId: song?.id ?? null,
        songTitle: song?.title ?? null,
      }
    })
    if (songId) return views
    // Parsed, not compared as text: a row written here and one pulled from the server spell
    // the same instant with different fractional-second precision.
    return views.sort((a, b) => {
      const unfiled = Number(!!a.songId) - Number(!!b.songId)
      return unfiled || Date.parse(b.recording.recorded_at) - Date.parse(a.recording.recorded_at)
    })
  }, [db, songId])
}
