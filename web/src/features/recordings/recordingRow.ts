import type { StorageFigures } from '../../db/meta'
import { isNotUploaded } from '../../db/recordings'
import { failedTriesLabel, fileStateLabel, formatBytes, formatDuration } from '../recording/format'
import { providerLabel } from '../links/display'
import type { RecordingView } from './useRecordings'

export const DELETE_UNSYNCED_NOTE = 'It has not been uploaded, so this cannot be undone.'
export const DELETE_SYNCED_NOTE = 'It is removed from every device.'

/** What a delete costs: a recording the server has never seen is only ever on this device. */
export function deleteRecordingMessage(view: RecordingView): string {
  return view.recording.state === 'pending_upload' && isNotUploaded(view.file)
    ? DELETE_UNSYNCED_NOTE
    : DELETE_SYNCED_NOTE
}

const RECORDED_AT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function recordedAtLabel(recordedAt: string): string {
  return RECORDED_AT.format(new Date(recordedAt))
}

/**
 * A recording's title: its own label, then its tune's, then when it was made. A list that
 * already heads the recording's group with the tune skips the tune and goes straight to the
 * date, so a row never repeats the heading above it.
 */
export function recordingTitle(
  view: RecordingView,
  { tuneNamedAbove = false }: { tuneNamedAbove?: boolean } = {},
): string {
  const recordedAt = `Recording, ${recordedAtLabel(view.recording.recorded_at)}`
  return view.recording.label ?? (tuneNamedAbove ? recordedAt : (view.tuneTitle ?? recordedAt))
}

/** True when `recordingTitle` falls through to the date, which the meta line then leaves out. */
export function titleIsDate(
  view: RecordingView,
  { tuneNamedAbove = false }: { tuneNamedAbove?: boolean } = {},
): boolean {
  return view.recording.label == null && (tuneNamedAbove || view.tuneTitle == null)
}

/** The site an imported recording came from; null for one made here. */
export function originLabel(origin: string): string | null {
  return origin === 'own' ? null : providerLabel({ provider: origin })
}

/** The meta parts in order, already worded; the row joins them with " · ". */
export function recordingMeta(
  view: RecordingView,
  storage: StorageFigures | null,
  { dateInTitle = false }: { dateInTitle?: boolean } = {},
): string[] {
  const { recording, file } = view
  const status = fileStateLabel(recording, file)
  const duration = formatDuration(recording.duration_ms ?? file?.local_duration_ms)
  const attempts = file?.upload_attempts ?? 0
  const waiting = file?.local_state === 'captured' || file?.local_state === 'uploading'
  const tries = waiting && attempts > 0 ? failedTriesLabel(attempts) : null
  const blockedQuota = file?.local_state === 'blocked_quota'
  const storageLabel =
    blockedQuota && storage
      ? `${formatBytes(storage.used_bytes)} of ${formatBytes(storage.quota_bytes)} used`
      : null
  // A recording that needs nothing from the musician shows when it was made instead of a status,
  // unless its title already says so.
  const date = dateInTitle ? null : recordedAtLabel(recording.recorded_at)
  return [originLabel(recording.origin), duration, status || date, tries, storageLabel].filter(
    (part): part is string => Boolean(part),
  )
}

export type RowControl = 'play' | 'close' | 'download' | 'downloading' | 'none'

/**
 * Which control a recording row shows: close beats play for a loaded item even after its blob
 * is gone, play needs the blob held here, download and its progress belong to the server's copy.
 */
export function rowControl(
  view: RecordingView,
  args: { loaded: boolean; downloading: boolean },
): RowControl {
  if (args.loaded) return 'close'
  if (view.file?.blob) return 'play'
  // A stale downloading file state means nothing once the server no longer has a ready copy
  // to fetch, so it stops short of the spinner and falls back to none, freeing Retry to show.
  if (view.recording.state !== 'ready') return 'none'
  return args.downloading ? 'downloading' : 'download'
}

/** Which retry a stuck row needs, or null when it is not stuck. */
export function retryKind(view: RecordingView): 'upload' | 'transcode' | null {
  const { recording, file } = view
  const attempts = file?.upload_attempts ?? 0
  // A refused upload, or one the loop keeps failing to send, is stuck until the musician acts.
  const uploadStuck =
    file?.local_state === 'failed_upload' || (file?.local_state === 'captured' && attempts > 0)
  if (uploadStuck) return 'upload'
  if (recording.state === 'failed') return 'transcode'
  return null
}
