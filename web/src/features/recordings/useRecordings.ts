import { useLiveQuery } from 'dexie-react-hooks'
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
    const rows = songId
      ? await db.recordings.where('song_id').equals(songId).toArray()
      : await db.recordings.toArray()
    const live = rows.filter((r) => !r.deleted_at)
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
    if (songId) return views.sort((a, b) => a.recording.position - b.recording.position)
    return views.sort((a, b) => {
      const unfiled = Number(!!a.songId) - Number(!!b.songId)
      return unfiled || b.recording.recorded_at.localeCompare(a.recording.recorded_at)
    })
  }, [db, songId])
}
