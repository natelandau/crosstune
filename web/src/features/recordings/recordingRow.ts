import { RECORDING_ORIGINS } from '../../api/vocabulary'
import type { StorageFigures } from '../../db/meta'
import { isNotUploaded } from '../../db/recordings'
import {
  addedDateLabel,
  addedDay,
  failedTriesLabel,
  fileStateLabel,
  formatBytes,
  formatDuration,
  knownRecordedDate,
  recordingDateLabel,
} from '../recording/format'
import { providerLabel } from '../links/display'
import type { RecordingSort } from './arrangeRecordings'
import type { RecordingView } from './useRecordings'

export const DELETE_UNSYNCED_NOTE = 'It has not been uploaded, so this cannot be undone.'
export const DELETE_SYNCED_NOTE = 'It is removed from every device.'

/** What a delete costs: a recording the server has never seen is only ever on this device. */
export function deleteRecordingMessage(view: RecordingView): string {
  return view.recording.state === 'pending_upload' && isNotUploaded(view.file)
    ? DELETE_UNSYNCED_NOTE
    : DELETE_SYNCED_NOTE
}

/**
 * A recording's title: its own label, then its tune's, then when it was played, else when it
 * was added. A list that already heads the recording's group with the tune skips the tune and
 * goes straight to the date, so a row never repeats the heading above it.
 */
export function recordingTitle(
  view: RecordingView,
  { tuneNamedAbove = false }: { tuneNamedAbove?: boolean } = {},
): string {
  const date = knownRecordedDate(view.recording) ?? addedDay(view.recording.added_at)
  const dated = `Recording, ${date}`
  return view.recording.label ?? (tuneNamedAbove ? dated : (view.tuneTitle ?? dated))
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

/** Only a page, never a script or a local scheme, may be opened from a stored URL. */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** The site an imported recording came from and its page there, when that page can be opened. */
export function originLink(recording: {
  origin: string
  origin_url?: string | null
}): { site: string; url: string } | null {
  const site = originLabel(recording.origin)
  const url = recording.origin_url
  return site && url && isWebUrl(url) ? { site, url } : null
}

/** Vocabulary order; an origin the client predates sorts last. */
export function sortOrigins(origins: readonly string[]): string[] {
  const rank = (origin: string) => {
    const at = (RECORDING_ORIGINS as readonly string[]).indexOf(origin)
    return at === -1 ? RECORDING_ORIGINS.length : at
  }
  return [...origins].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/**
 * The meta parts in order, already worded; the row joins them with " · ". Under Date added the
 * date is when the recording was added; under every other sort it is when it was played.
 */
export function recordingMeta(
  view: RecordingView,
  storage: StorageFigures | null,
  { dateInTitle = false, sort }: { dateInTitle?: boolean; sort?: RecordingSort } = {},
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
  // The title's date is the recorded one when known, so under Date added it differs and stays.
  const titleShowsSameDate =
    dateInTitle && (sort !== 'added' || knownRecordedDate(recording) === null)
  // A recording that needs nothing from the musician shows a date instead of a status, unless
  // its title already says the same.
  const date = titleShowsSameDate
    ? null
    : sort === 'added'
      ? addedDateLabel(recording.added_at)
      : recordingDateLabel(recording)
  return [duration, status || date, tries, storageLabel].filter((part): part is string =>
    Boolean(part),
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
