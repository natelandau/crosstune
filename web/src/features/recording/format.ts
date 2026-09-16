import type { LocalFileState } from '../../db/recordings'

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
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
  capturing: 'Recording',
  captured: 'Waiting to upload',
  uploading: 'Uploading',
  blocked_quota: 'Storage full',
  failed_upload: 'Upload failed',
  downloading: 'Downloading',
}

const SERVER_LABELS: Record<string, string> = {
  uploaded: 'Processing',
  processing: 'Processing',
  failed: "Couldn't process",
}

/** What to tell the user about a recording that is not simply playable. Empty when it is. */
export function fileStateLabel(
  row: { state: string; error: string | null },
  file: { local_state: LocalFileState } | undefined,
): string {
  const local = file ? LOCAL_LABELS[file.local_state] : undefined
  if (local !== undefined) return local
  return SERVER_LABELS[row.state] ?? ''
}
