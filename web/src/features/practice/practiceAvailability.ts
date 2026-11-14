import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import { useOnline } from '../../sync/SyncProvider'
import { useCurrentAudio } from '../player/useCurrentAudio'
import { useRecordingDownload } from '../player/useRecordingDownload'
import { DOWNLOAD_FAILED, fileStateLabel, NOT_AVAILABLE } from '../../text/format'
import { splitIncomplete, waitsForCut, type UploadLimits } from '../../domain/recordingLimits'
import { trimmedLengthMs, trimPending } from './recordingRange'
import { SPLIT_BUSY } from './splitCopy'
import { TRIM_BUSY, TRIM_WHILE_DOWNLOADING, TRIM_WHILE_RECORDING } from './trimViewCopy'

/** How far fetching the audio has got, for a recording this device does not hold yet.
 * `unavailable` is one the server has no playback file for yet, so there is nothing to fetch. */
export type AudioFetch = 'held' | 'unavailable' | 'offline' | 'downloading' | 'failed'

/** Whether the recording's own file is still being captured. A piece the server has not cut
 * plays from its parent's file, whose state is not the piece's. */
function capturing(
  recording: Pick<LocalRecording, 'id'>,
  file: RecordingFile | undefined,
): boolean {
  return file?.id === recording.id && file.local_state === 'capturing'
}

/** Why Trim cannot be used right now, or undefined when it can. `limits` are the server's upload
 * caps, or null when unknown. */
export function trimDisabledReason(
  recording: LocalRecording,
  file: RecordingFile | undefined,
  limits: UploadLimits | null,
  audio: AudioFetch,
): string | undefined {
  if (capturing(recording, file)) return TRIM_WHILE_RECORDING
  if (audio === 'unavailable') return fileStateLabel(recording, file, limits) || NOT_AVAILABLE
  if (audio === 'offline') return OFFLINE
  if (audio === 'downloading') return TRIM_WHILE_DOWNLOADING
  if (audio === 'failed') return DOWNLOAD_FAILED
  if (trimPending(recording)) return TRIM_BUSY
  // An imported file whose length the browser could not read has no range to trim until the
  // server measures it.
  if (trimmedLengthMs(recording, file) === null) return NOT_AVAILABLE
  return undefined
}

/** Why Split cannot be used right now, or undefined when it can: Trim's reasons first, then a
 * split of the row still being cut, or the row being a piece waiting for its cut. */
export function splitDisabledReason(
  recording: LocalRecording,
  file: RecordingFile | undefined,
  limits: UploadLimits | null,
  audio: AudioFetch,
): string | undefined {
  const trimBlocked = trimDisabledReason(recording, file, limits, audio)
  if (trimBlocked !== undefined) return trimBlocked
  if (splitIncomplete(recording)) return SPLIT_BUSY
  if (waitsForCut(recording)) return SPLIT_BUSY
  return undefined
}

/** Why the waveform, transport, and modes cannot be used: the reason practice shows, or null
 * where the Plan sheet covers practice and says why itself. */
export type PracticeBlock = string | null

/** Why the waveform, transport, and modes cannot be used right now, or undefined when they can.
 * `recordingsPlay` is false while the plan plays no recording. */
export function practiceBlock(
  recording: Pick<LocalRecording, 'id'>,
  file: RecordingFile | undefined,
  audio: AudioFetch,
  recordingsPlay: boolean,
): PracticeBlock | undefined {
  if (!recordingsPlay) return null
  if (capturing(recording, file)) return TRIM_WHILE_RECORDING
  if (audio === 'offline') return OFFLINE
  if (audio === 'downloading') return TRIM_WHILE_DOWNLOADING
  return undefined
}

/**
 * The state of this device's copy of the audio. Asking the sync engine joins any download the
 * dock already started, so the two never fetch the same file twice. A recording still being
 * read (null) has nothing to fetch yet, and nothing is fetched unless `fetches`, such as while
 * the plan plays no recording.
 */
export function useAudioFetch(
  recording: LocalRecording | null,
  file: RecordingFile | undefined,
  fetches: boolean,
): AudioFetch {
  const online = useOnline()
  const fetched = fetches ? recording : null
  useCurrentAudio(fetched, file)
  const { blob, failed } = useRecordingDownload(fetched, file)
  if (!recording || (!file?.blob && recording.state !== 'ready')) return 'unavailable'
  if (blob) return 'held'
  if (!online) return 'offline'
  if (file?.local_state === 'downloading') return 'downloading'
  return failed ? 'failed' : 'downloading'
}
