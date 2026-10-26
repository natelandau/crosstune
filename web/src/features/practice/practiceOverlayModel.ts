import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import { useOnline } from '../../sync/SyncProvider'
import { useCurrentAudio } from '../player/useCurrentAudio'
import { useRecordingDownload } from '../player/useRecordingDownload'
import { DOWNLOAD_FAILED, fileStateLabel, NOT_AVAILABLE } from '../../text/format'
import { PREMIUM_RECORDINGS_TITLE } from '../plan/planCopy'
import { trimmedLengthMs, trimPending } from './recordingRange'
import { TRIM_BUSY, TRIM_WHILE_DOWNLOADING, TRIM_WHILE_RECORDING } from './trimViewCopy'

/** How far fetching the audio has got, for a recording this device does not hold yet.
 * `unavailable` is one the server has no playback file for yet, so there is nothing to fetch. */
export type AudioFetch = 'held' | 'unavailable' | 'offline' | 'downloading' | 'failed'

/** Why Trim cannot be used right now, or undefined when it can. `recordingsPlay` is false while
 * the plan plays no recording. */
export function trimDisabledReason(
  recording: LocalRecording,
  file: RecordingFile | undefined,
  audio: AudioFetch,
  recordingsPlay: boolean,
): string | undefined {
  if (!recordingsPlay) return PREMIUM_RECORDINGS_TITLE
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

/** Why the waveform, transport, and modes cannot be used right now, or undefined when they can.
 * `recordingsPlay` is false while the plan plays no recording. */
export function practiceDisabledReason(
  file: RecordingFile | undefined,
  audio: AudioFetch,
  recordingsPlay: boolean,
): string | undefined {
  if (!recordingsPlay) return PREMIUM_RECORDINGS_TITLE
  if (file?.local_state === 'capturing') return TRIM_WHILE_RECORDING
  if (audio === 'downloading') return TRIM_WHILE_DOWNLOADING
  return undefined
}

/**
 * The state of this device's copy of the audio. Asking the sync engine joins any download the
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
