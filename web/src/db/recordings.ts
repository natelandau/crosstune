export const AUDIO_QUALITIES = ['low', 'standard', 'high'] as const
export type AudioQuality = (typeof AUDIO_QUALITIES)[number]

export const AUDIO_BITRATES: Record<AudioQuality, number> = {
  low: 48_000,
  standard: 64_000,
  high: 128_000,
}

export function isAudioQuality(value: unknown): value is AudioQuality {
  return typeof value === 'string' && (AUDIO_QUALITIES as readonly string[]).includes(value)
}

/** The preset a settings row holds, or standard when there is no usable value. */
export function storedAudioQuality(
  row: { audio_quality?: unknown } | null | undefined,
): AudioQuality {
  return isAudioQuality(row?.audio_quality) ? row.audio_quality : 'standard'
}

export const CHUNK_MS = 5000

// iOS records AAC in MP4 and Android Opus in WebM; the server transcodes whichever arrives.
const MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'] as const

export function pickMimeType(isSupported: (mimeType: string) => boolean): string {
  return MIME_CANDIDATES.find((m) => isSupported(m)) ?? ''
}

/** The type without codec parameters, which is what the presigned upload is pinned to. */
export function baseContentType(mimeType: string): string {
  const base = mimeType.split(';', 1)[0]?.trim().toLowerCase()
  return base || 'application/octet-stream'
}

export type LocalFileState =
  | 'capturing'
  | 'captured'
  | 'uploading'
  | 'uploaded'
  | 'blocked_quota'
  | 'failed_upload'
  | 'downloading'
  | 'downloaded'

/** Local states whose blob the server does not have yet, so this device holds the only copy. */
export const NOT_UPLOADED_STATES: readonly LocalFileState[] = [
  'capturing',
  'captured',
  'uploading',
  'blocked_quota',
  'failed_upload',
]

export function isNotUploaded(file: { local_state: LocalFileState } | null | undefined): boolean {
  return !!file && NOT_UPLOADED_STATES.includes(file.local_state)
}

export interface RecordingFile {
  id: string
  blob: Blob | null
  mime: string | null
  bytes: number
  local_duration_ms: number | null
  local_state: LocalFileState
  pinned: boolean
  error: string | null
  /** Epoch ms of the last chunk appended while capturing; a gap past the stale-capture
   * threshold is what marks the capture abandoned rather than still in progress. */
  last_chunk_at: number | null
  /** The song a capture was started for, so recovery can file an interrupted take under it. */
  song_id: string | null
  /** When a capture started, so recovery stamps an interrupted take with its real start. */
  recorded_at: string | null
  /** Epoch ms before which uploadPass skips this row, set by a transient failure's backoff. */
  next_attempt_at: number | null
  /** Consecutive transient upload failures since the last success, driving the backoff delay. */
  upload_attempts: number
}

export interface RecordingChunk {
  recording_id: string
  idx: number
  blob: Blob
}
