import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'

export interface PlaybackWindow {
  fromS: number
  toS: number
  lengthMs: number
}

type WindowRow = Pick<LocalRecording, 'trim_start_ms' | 'trim_end_ms' | 'source_duration_ms'>
type WindowFile = Pick<RecordingFile, 'blob_start_ms' | 'local_duration_ms'>

/**
 * The trim range as seek offsets into whatever blob is loaded, in seconds. A downloaded
 * blob can start partway through the source (a trimmed playback file), so every offset is
 * relative to the blob's own start rather than the source's timeline, and reads
 * `file.blob_start_ms` rather than the row's `playback_start_ms` so a not-yet-refreshed
 * blob still lines up with what is actually loaded. Narrowed to the exact fields it reads,
 * so a caller can build its dependency list from those fields alone.
 */
export function playbackWindow(row: WindowRow, file: WindowFile): PlaybackWindow {
  const sourceEndMs = row.trim_end_ms ?? row.source_duration_ms ?? file.local_duration_ms
  const blobLengthMs = file.local_duration_ms
  const clampMs = (ms: number): number => {
    const atLeastZero = Math.max(0, ms)
    return blobLengthMs === null ? atLeastZero : Math.min(atLeastZero, blobLengthMs)
  }
  const fromMs = clampMs(row.trim_start_ms - file.blob_start_ms)
  // An imported file not yet transcoded has no known length anywhere; it plays to its own
  // end, which the engine reads from the loaded audio.
  if (sourceEndMs === null) return { fromS: fromMs / 1000, toS: Infinity, lengthMs: 0 }
  const toMs = clampMs(sourceEndMs - file.blob_start_ms)
  return { fromS: fromMs / 1000, toS: toMs / 1000, lengthMs: Math.max(0, toMs - fromMs) }
}
