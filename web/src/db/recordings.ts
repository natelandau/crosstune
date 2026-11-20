import type { Table } from 'dexie'
import { AUDIO_QUALITIES, type AudioQuality } from '../api/vocabulary'
import type { CrosstuneDb } from './schema'

function isAudioQuality(value: unknown): value is AudioQuality {
  return typeof value === 'string' && (AUDIO_QUALITIES as readonly string[]).includes(value)
}

/** Matches the server's default, so a device with no settings row records as a new row would. */
export const DEFAULT_AUDIO_QUALITY: AudioQuality = 'highest'

/** The preset a settings row holds, or the default when there is no usable value. */
export function storedAudioQuality(
  row: { audio_quality?: unknown } | null | undefined,
): AudioQuality {
  return isAudioQuality(row?.audio_quality) ? row.audio_quality : DEFAULT_AUDIO_QUALITY
}

/**
 * The audio quality a write keeps: the stored value even when this client does not know it, so
 * a newer client's choice survives, or the default when there is none.
 */
export function storedAudioQualityValue(
  row: { audio_quality?: unknown; deleted_at?: string | null } | null | undefined,
): string {
  return row && !row.deleted_at && typeof row.audio_quality === 'string'
    ? row.audio_quality
    : storedAudioQuality(null)
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

/** The sync tag the page registers for the service worker to upload its hand-offs. */
export const UPLOAD_SYNC_TAG = 'recording-uploads'

/** Failed worker runs after which the page takes a hand-off back and uploads the file itself. */
export const HANDOFF_TAKE_BACK_ATTEMPTS = 3

/** An upload the page reserved and left for the service worker to send and confirm. */
export interface UploadHandoff {
  url: string
  confirm_token: string
  content_type: string
  /** Epoch ms when the presigned URL and the slot expire. */
  expires_at: number
  /** Failed worker runs for this hand-off. */
  attempts: number
  /** The server refused the worker's confirm, so the page takes the file back and settles it. */
  refused?: boolean
}

export interface RecordingFile {
  id: string
  blob: Blob | null
  mime: string | null
  bytes: number
  local_duration_ms: number | null
  local_state: LocalFileState
  error: string | null
  /** The playback_rev this blob was downloaded for, or null for a captured or imported original. */
  blob_rev: string | null
  /** Where this blob starts within the source, so a trimmed download's timeline lines up. */
  blob_start_ms: number
  /** A whole cached peaks file for the waveform, downloaded once per revision. */
  peaks: Uint8Array | null
  /** The peaks_rev this file was downloaded for, or null before any peaks are cached. */
  peaks_rev: string | null
  /** Epoch ms of the last chunk appended while capturing; a gap past the stale-capture
   * threshold is what marks the capture abandoned rather than still in progress. */
  last_chunk_at: number | null
  /** The tune a capture was started for, so recovery can file an interrupted recording under it. */
  tune_id: string | null
  /** When a capture started, so recovery stamps an interrupted recording with its real start. */
  recorded_at: string | null
  /** Epoch ms before which uploadPass skips this row, set by a transient failure's backoff. */
  next_attempt_at: number | null
  /** Consecutive transient upload failures since the last success, driving the backoff delay. */
  upload_attempts: number
  /** The upload left for the service worker, or null when the page sends its own. A row
   * stored before hand-offs existed has no field, which also means none. */
  handoff?: UploadHandoff | null
  /** The audio is still the capture's chunks, with `blob` null. Joining them into one stored
   * blob copies every byte, so a capture keeps its chunks until that copy fits. A row stored
   * before this field existed has none, which also means not chunked. */
  chunked?: boolean
}

/** A file whose upload is left for the service worker. */
export type HandedOffFile = RecordingFile & { handoff: UploadHandoff }

/** Change a file only while it still holds `handoff`, so whichever of the page and the worker
 * settles the hand-off first keeps its result. Resolves to the number of rows changed. */
export function modifyWhileHeld(
  files: Table<RecordingFile, string>,
  id: string,
  handoff: UploadHandoff,
  change: (row: RecordingFile) => void,
): Promise<number> {
  return files
    .where(':id')
    .equals(id)
    .filter((row) => row.handoff?.url === handoff.url)
    .modify(change)
}

/** A file whose bytes are all here: a capture in progress or a download without a blob is not.
 * A chunked file counts only once `withLocalAudio` has joined its chunks into `blob`. */
export function isComplete(file: RecordingFile): file is RecordingFile & { blob: Blob } {
  return file.blob instanceof Blob && file.local_state !== 'capturing'
}

/** A finished capture whose audio is still its chunks, with no joined blob stored. */
export function holdsChunkedAudio(file: RecordingFile | null | undefined): file is RecordingFile {
  return !!file && !!file.chunked && file.blob === null && file.local_state !== 'capturing'
}

/** Whether this device holds the file's audio, as one blob or as a finished capture's chunks. */
export function hasLocalAudio(file: RecordingFile | null | undefined): file is RecordingFile {
  return !!file && (file.blob !== null || holdsChunkedAudio(file))
}

/** A chunked file's chunks joined into one blob, in order. The join holds references to the
 * stored chunks, so it copies nothing. */
export async function joinChunks(
  files: Table<RecordingFile, string>,
  chunks: Table<RecordingChunk, [string, number]>,
  file: RecordingFile,
): Promise<Blob> {
  const rows = await chunks.where('recording_id').equals(file.id).sortBy('idx')
  // A stored join that committed after `file` was read moved the audio into the row's blob.
  if (rows.length === 0 && file.bytes > 0) {
    const current = await files.get(file.id)
    if (current?.blob) return current.blob
  }
  return new Blob(
    rows.map((row) => row.blob),
    { type: file.mime ?? rows[0]?.blob.type ?? '' },
  )
}

/** Deletes a recording's chunks. Call inside a transaction that holds `recording_chunks`. */
export async function deleteChunks(db: CrosstuneDb, id: string): Promise<void> {
  await db.recording_chunks.where('recording_id').equals(id).delete()
}

/**
 * The file with a chunked capture's chunks joined into `blob`, for code that reads the audio.
 * A joined row is a view: writing it back would store the copy that chunking avoids.
 */
export async function withLocalAudio<T extends RecordingFile | undefined>(
  db: CrosstuneDb,
  file: T,
): Promise<T> {
  return holdsChunkedAudio(file)
    ? ({ ...file, blob: await joinChunks(db.recording_files, db.recording_chunks, file) } as T)
    : file
}

/** `withLocalAudio` for each of `files`. */
export function withLocalAudioAll<T extends RecordingFile | undefined>(
  db: CrosstuneDb,
  files: readonly T[],
): Promise<T[]> {
  return Promise.all(files.map((file) => withLocalAudio(db, file)))
}

/** The file's audio as one blob, or null when this device holds none. */
export async function readLocalAudio(
  db: CrosstuneDb,
  file: RecordingFile | null | undefined,
): Promise<Blob | null> {
  if (!hasLocalAudio(file)) return null
  return file.blob ?? joinChunks(db.recording_files, db.recording_chunks, file)
}

export interface RecordingChunk {
  recording_id: string
  idx: number
  blob: Blob
}

/**
 * How many recordings the account keeps. The deleted_at index holds only tombstones, since null
 * is not indexable, so this reads two counts and no rows.
 */
export function countLiveRecordings(db: CrosstuneDb): Promise<number> {
  return db.transaction('r', db.recordings, async () => {
    const [all, deleted] = await Promise.all([
      db.recordings.count(),
      db.recordings.orderBy('deleted_at').count(),
    ])
    return all - deleted
  })
}
