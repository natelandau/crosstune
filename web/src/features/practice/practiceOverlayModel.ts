import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import { useOnline } from '../../sync/SyncProvider'
import { useCurrentAudio } from '../player/useCurrentAudio'
import { useRecordingDownload } from '../player/useRecordingDownload'
import { DOWNLOAD_FAILED, fileStateLabel, NOT_AVAILABLE } from '../recording/format'
import { trimmedLengthMs, trimPending } from './recordingRange'
import { TRIM_BUSY, TRIM_WHILE_DOWNLOADING, TRIM_WHILE_RECORDING } from './trimViewCopy'

/** Where fetching the audio stands, for a recording this device does not hold yet.
 * `unavailable` is one the server has no playback file for yet, so there is nothing to fetch. */
export type AudioFetch = 'held' | 'unavailable' | 'offline' | 'downloading' | 'failed'

/** Why Trim cannot be used right now, or undefined when it can. */
export function trimBlocker(
  recording: LocalRecording,
  file: RecordingFile | undefined,
  audio: AudioFetch,
): string | undefined {
  if (file?.local_state === 'capturing') return TRIM_WHILE_RECORDING
  if (audio === 'unavailable') return fileStateLabel(recording, file) || NOT_AVAILABLE
  if (audio === 'offline') return OFFLINE
  if (audio === 'downloading') return TRIM_WHILE_DOWNLOADING
  if (audio === 'failed') return DOWNLOAD_FAILED
  if (trimPending(recording)) return TRIM_BUSY
  // An imported file whose length the browser could not read has no range to trim until the
  // server measures it.
  if (trimmedLengthMs(recording, file) === null) return NOT_AVAILABLE
  return undefined
}

/** Why the waveform, transport, and modes cannot be used right now, or undefined when they can. */
export function practiceBlocker(
  file: RecordingFile | undefined,
  audio: AudioFetch,
): string | undefined {
  if (file?.local_state === 'capturing') return TRIM_WHILE_RECORDING
  if (audio === 'downloading') return TRIM_WHILE_DOWNLOADING
  return undefined
}

/**
 * Where this device's copy of the audio stands. Asking the sync engine joins any download the
 * dock already started, so the two never fetch the same file twice. A recording still being
 * read (null) has nothing to fetch yet.
 */
export function useAudioFetch(
  recording: LocalRecording | null,
  file: RecordingFile | undefined,
): AudioFetch {
  const online = useOnline()
  useCurrentAudio(recording, file)
  const { blob, failed } = useRecordingDownload(recording, file)
  if (!recording || (!file?.blob && recording.state !== 'ready')) return 'unavailable'
  if (blob) return 'held'
  if (!online) return 'offline'
  if (file?.local_state === 'downloading') return 'downloading'
  return failed ? 'failed' : 'downloading'
}
