import type { StorageUsage } from '../db/meta'
import type { RecordingFile } from '../db/recordings'
import type { LocalRecording } from '../db/types'

export const MAX_RECORDING_MS = 10_800_000
/** The longest source the server accepts even as a split parent. */
export const MAX_SPLIT_SOURCE_MS = 43_200_000
/** The length at which a capture stops: a minute short of `MAX_SPLIT_SOURCE_MS`, since the
 * last chunk or buffer lands after the check and the saved length must stay within it. */
export const CAPTURE_STOP_MS = MAX_SPLIT_SOURCE_MS - 60_000

/** The per-file upload caps the server reported; null until it has. */
export type UploadLimits = Pick<StorageUsage, 'max_file_bytes' | 'split_parent_max_file_bytes'>

/**
 * A recording too long or too large to upload has no server file to cut until a split is
 * requested for it; only a split parent may upload past the plain per-file cap. A file too
 * long or too large even for a split parent is not held: its upload meets the server's refusal.
 */
export function mustSplitToUpload(
  row: Partial<Pick<LocalRecording, 'split_id'>>,
  file:
    | (Pick<RecordingFile, 'local_state'> &
        Partial<Pick<RecordingFile, 'local_duration_ms' | 'bytes'>>)
    | undefined,
  limits: UploadLimits | null,
): boolean {
  if (row.split_id != null || file == null || file.local_state === 'uploaded') return false
  const ms = file.local_duration_ms
  const bytes = file.bytes
  const over = (cap: number | undefined) => cap != null && bytes != null && bytes > cap
  if ((ms != null && ms > MAX_SPLIT_SOURCE_MS) || over(limits?.split_parent_max_file_bytes)) {
    return false
  }
  return (ms != null && ms > MAX_RECORDING_MS) || over(limits?.max_file_bytes)
}

/** The server marks a split complete once every piece is cut; a later split reopens it. */
export function splitIncomplete(parent: LocalRecording): boolean {
  return parent.split_id != null && parent.split_completed_id !== parent.split_id
}

/** A live piece still waiting for the server to cut it, which plays from its parent's audio. A
 * failed piece is not waiting: it has no cut coming. */
export function waitsForCut(
  piece: Pick<LocalRecording, 'split_from_id' | 'deleted_at' | 'state'>,
): boolean {
  return piece.split_from_id != null && !piece.deleted_at && piece.state === 'processing'
}

/**
 * Whether a parent recording's audio must stay, and its Delete wait: it has not failed and a
 * live piece split from it is still waiting for its cut. The server's purge holds the parent's
 * original by the same rule.
 */
export function holdsSplitAudio(
  parent: Pick<LocalRecording, 'id' | 'state'>,
  waitingParentIds: ReadonlySet<string>,
): boolean {
  return parent.state !== 'failed' && waitingParentIds.has(parent.id)
}

export const MAX_SPLIT_PIECES = 50

/** The shortest kept range, a trim's or a split piece's, as `MIN_TRIM_MS` in
 * `api/src/crosstune/vocabulary.py` enforces. */
export const MIN_KEPT_MS = 1000

type RangeEndRow = Pick<LocalRecording, 'trim_end_ms' | 'source_duration_ms' | 'duration_ms'>

/** Where a split's range ends on the source timeline, or null when nothing says. A recording not
 * yet uploaded has its length only on the local file. */
export function splitRangeEnd(
  row: RangeEndRow,
  file: Pick<RecordingFile, 'local_duration_ms'> | undefined,
): number | null {
  return (
    row.trim_end_ms ?? row.source_duration_ms ?? row.duration_ms ?? file?.local_duration_ms ?? null
  )
}

export type PieceProblem = 'too-many' | 'too-short' | 'too-long'

/** What keeps a split at `bounds` (ascending, the range's ends included) from saving, or null.
 * Only a range over `MAX_RECORDING_MS` can hold a piece over it. */
export function pieceProblem(bounds: readonly number[], overLimit: boolean): PieceProblem | null {
  if (bounds.length - 1 > MAX_SPLIT_PIECES) return 'too-many'
  for (let i = 1; i < bounds.length; i++) {
    const length = bounds[i]! - bounds[i - 1]!
    if (length < MIN_KEPT_MS) return 'too-short'
    if (overLimit && length > MAX_RECORDING_MS) return 'too-long'
  }
  return null
}

/** The name a split piece gets: its parent's label and the piece number, counting from 1. */
export function pieceLabel(parentLabel: string | null, n: number): string {
  const label = parentLabel?.trim()
  return label ? `${label}, part ${n}` : `Part ${n}`
}
