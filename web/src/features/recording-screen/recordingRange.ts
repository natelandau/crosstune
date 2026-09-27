import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { loudestPeak, parsePeaks, slicePeaks, type Peaks } from '../waveform/peaks'

type RangeRow = Pick<
  LocalRecording,
  | 'state'
  | 'trim_start_ms'
  | 'trim_end_ms'
  | 'source_duration_ms'
  | 'playback_start_ms'
  | 'playback_end_ms'
>

export interface ShownPeaks {
  peaks: Peaks
  /** The loudest point in the whole file, which the bars scale to. */
  loudest: number
}

/**
 * The peaks for the trimmed range, or null when there are none that line up. Capture-time
 * peaks (no `peaks_rev`) cover the whole source from 0. The server's cover its playback file,
 * which starts at the row's `playback_start_ms`, but only for the revision the row names: a
 * file from an older revision starts somewhere else.
 */
export function shownPeaks(
  row: Pick<LocalRecording, 'trim_start_ms' | 'trim_end_ms' | 'playback_start_ms' | 'peaks_rev'>,
  file: Pick<RecordingFile, 'peaks' | 'peaks_rev'> | undefined,
): ShownPeaks | null {
  if (!file?.peaks) return null
  if (file.peaks_rev !== null && file.peaks_rev !== row.peaks_rev) return null
  let peaks: Peaks
  try {
    peaks = parsePeaks(file.peaks)
  } catch {
    return null
  }
  const fileStartMs = file.peaks_rev === null ? 0 : (row.playback_start_ms ?? 0)
  const fileLengthMs = (peaks.values.length * 1000) / peaks.pointsPerSecond
  const startMs = Math.max(0, row.trim_start_ms - fileStartMs)
  const trimEndMs = row.trim_end_ms ?? null
  const endMs = trimEndMs === null ? fileLengthMs : trimEndMs - fileStartMs
  return {
    peaks: slicePeaks(peaks, startMs, Math.max(startMs, endMs)),
    loudest: loudestPeak(peaks.values),
  }
}

/**
 * True while the server has yet to cut a ready recording's playback file to its trim, which
 * is when a second trim would race the one queued.
 */
export function trimPending(row: RangeRow): boolean {
  if (row.state !== 'ready') return false
  if (row.playback_start_ms === null || row.playback_end_ms === null) return false
  const trimEndMs = row.trim_end_ms ?? row.source_duration_ms
  return row.trim_start_ms !== row.playback_start_ms || trimEndMs !== row.playback_end_ms
}

/** How long the trimmed recording plays, or null when nothing says how long it is. */
export function trimmedLengthMs(
  row: Pick<LocalRecording, 'trim_start_ms' | 'trim_end_ms' | 'source_duration_ms'>,
  file: Pick<RecordingFile, 'local_duration_ms'> | undefined,
): number | null {
  const endMs = row.trim_end_ms ?? row.source_duration_ms ?? file?.local_duration_ms ?? null
  return endMs === null ? null : Math.max(0, endMs - row.trim_start_ms)
}
