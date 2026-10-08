import type { RecordingPrecision } from '../../api/vocabulary'
import type { LocalFileState } from '../../db/recordings'
import { isRecordingPrecision } from '../../db/types'

export const DOWNLOAD_FAILED = "Couldn't download"
export const DOWNLOADING = 'Downloading'
export const NOT_AVAILABLE = 'Not available'
export const PROCESS_FAILED = "Couldn't process"
/** A capture under way, and the name of the Recording settings category. */
export const RECORDING = 'Recording'
export const STORAGE_FULL = 'Storage full'
export const UPLOAD_FAILED = 'Upload failed'
export const WAITING_TO_UPLOAD = 'Waiting to upload'

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const TAKEN_AT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const ADDED_ON = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const TAKEN_TIME = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

// A partial date is stored as UTC midnight at the start of its period, so it is read in UTC:
// read locally west of UTC, 1937 would read as 1936.
const PARTIAL: Record<Exclude<RecordingPrecision, 'time'>, Intl.DateTimeFormat> = {
  year: new Intl.DateTimeFormat(undefined, { year: 'numeric', timeZone: 'UTC' }),
  month: new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  day: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }),
}

/** When the music was played, worded only as far as its precision knows. */
export function recordedDateLabel(recordedAt: string, precision: RecordingPrecision): string {
  const date = new Date(recordedAt)
  return precision === 'time' ? TAKEN_AT.format(date) : PARTIAL[precision].format(date)
}

/** The time of day a take was recorded, in local time like the rest of an exact date. */
export function recordedTime(recordedAt: string): string {
  return TAKEN_TIME.format(new Date(recordedAt))
}

/** The day a recording was added, in local time since `added_at` is an exact instant. */
export function addedDay(addedAt: string): string {
  return ADDED_ON.format(new Date(addedAt))
}

export function addedDateLabel(addedAt: string): string {
  return `Added ${addedDay(addedAt)}`
}

interface DatedRow {
  added_at: string
  recorded_at: string | null
  recorded_precision: string | null
}

/** The recorded date, or null when it is unknown or its precision is one this client predates. */
export function knownRecordedDate(row: DatedRow): string | null {
  return row.recorded_at && isRecordingPrecision(row.recorded_precision)
    ? recordedDateLabel(row.recorded_at, row.recorded_precision)
    : null
}

/** The recorded date when known, else when the recording was added. */
export function recordingDateLabel(row: DatedRow): string {
  return knownRecordedDate(row) ?? addedDateLabel(row.added_at)
}

/** `m:ss.t`, for placing a trim handle to the tenth of a second. */
export function formatPreciseDuration(ms: number): string {
  const tenths = Math.round(ms / 100)
  const minutes = Math.floor(tenths / 600)
  const seconds = Math.floor((tenths % 600) / 10)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  const [divisor, unit] = bytes < 1_000_000_000 ? [1_000_000, 'MB'] : [1_000_000_000, 'GB']
  // Truncates rather than rounds so a shown size never overstates what is actually there.
  const value = (Math.floor((bytes / divisor) * 10) / 10).toFixed(1).replace(/\.0$/, '')
  return `${value} ${unit}`
}

/** How many uploads of a waiting recording have failed so far. */
export function failedTriesLabel(count: number): string {
  return `${count} failed ${count === 1 ? 'try' : 'tries'}`
}

const LOCAL_LABELS: Partial<Record<LocalFileState, string>> = {
  capturing: RECORDING,
  captured: WAITING_TO_UPLOAD,
  uploading: 'Uploading',
  blocked_quota: STORAGE_FULL,
  failed_upload: UPLOAD_FAILED,
  downloading: DOWNLOADING,
}

const SERVER_LABELS: Record<string, string> = {
  uploaded: 'Processing',
  processing: 'Processing',
  failed: PROCESS_FAILED,
}

/** What to tell the user about a recording that is not simply playable. Empty when it is. */
export function fileStateLabel(
  row: { state: string; error: string | null; source: string },
  file: { local_state: LocalFileState } | undefined,
): string {
  // An import row has no file to upload: until the server answers, it is already being fetched.
  if (row.source === 'import' && row.state === 'pending_upload') return 'Processing'
  const local = file ? LOCAL_LABELS[file.local_state] : undefined
  if (local !== undefined) return local
  return SERVER_LABELS[row.state] ?? ''
}
