import { RECORDING_LIMITS } from '../api/vocabulary'
import type { LocalFileState, RecordingFile } from '../db/recordings'
import type { CrosstuneDb } from '../db/schema'
import type { LocalRecording } from '../db/types'
import { LINK_NOT_FOUND, RECORDING_NOT_FOUND, TUNE_NOT_FOUND } from './messages'
import {
  activeByPosition,
  defined,
  newId,
  nextPosition,
  now,
  putRow,
  recordingTx,
  tombstone,
  tombstoneWhere,
} from './write'

function emptyFile(id: string, overrides: Partial<RecordingFile> = {}): RecordingFile {
  return {
    id,
    blob: null,
    mime: null,
    bytes: 0,
    local_duration_ms: null,
    local_state: 'captured',
    error: null,
    blob_rev: null,
    blob_start_ms: 0,
    peaks: null,
    peaks_rev: null,
    last_chunk_at: null,
    tune_id: null,
    recorded_at: null,
    next_attempt_at: null,
    upload_attempts: 0,
    ...overrides,
  }
}

export function activeRecordingsForTune(
  db: CrosstuneDb,
  tuneId: string,
): Promise<LocalRecording[]> {
  return db.recordings.where('tune_id').equals(tuneId).toArray().then(activeByPosition)
}

async function putRecordingRow(
  db: CrosstuneDb,
  id: string,
  fields: {
    tuneId: string | null
    source: 'microphone' | 'upload' | 'import'
    label: string | null
    recordedAt: string
    origin?: string
    originUrl?: string
  },
): Promise<void> {
  const at = now()
  const siblings = fields.tuneId ? await activeRecordingsForTune(db, fields.tuneId) : []
  await putRow(db, 'recordings', {
    id,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    server_seq: 0,
    tune_id: fields.tuneId,
    label: fields.label,
    source: fields.source,
    origin: fields.origin ?? 'own',
    origin_url: fields.originUrl ?? null,
    recorded_at: fields.recordedAt,
    position: nextPosition(siblings),
    state: 'pending_upload',
    duration_ms: null,
    playback_mime: null,
    playback_bytes: null,
    error: null,
    trim_start_ms: 0,
    trim_end_ms: null,
    speed_percent: 100,
    pitch_cents: 0,
    source_duration_ms: null,
    playback_start_ms: null,
    playback_end_ms: null,
    playback_rev: null,
    peaks_rev: null,
  })
}

export async function beginCapture(
  db: CrosstuneDb,
  id: string,
  fields: { tuneId: string | null; recordedAt: string },
): Promise<void> {
  await db.recording_files.put(
    emptyFile(id, {
      local_state: 'capturing',
      last_chunk_at: Date.now(),
      tune_id: fields.tuneId,
      recorded_at: fields.recordedAt,
    }),
  )
}

export async function appendChunk(
  db: CrosstuneDb,
  id: string,
  idx: number,
  blob: Blob,
): Promise<void> {
  await db.transaction('rw', db.recording_files, db.recording_chunks, async () => {
    const file = await db.recording_files.get(id)
    // A chunk that arrives after recovery already finished or cancelled the capture
    // (or for a capture that never began) has nowhere left to go.
    if (!file || file.local_state !== 'capturing') return
    await db.recording_chunks.put({ recording_id: id, idx, blob })
    await db.recording_files.update(id, { last_chunk_at: Date.now() })
  })
}

/** The name a new recording gets: when it started, as the local `YYYY-MM-DD HH:MM`. */
export function defaultRecordingLabel(recordedAt: string | Date): string {
  const d = new Date(recordedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export async function finishCapture(
  db: CrosstuneDb,
  id: string,
  fields: {
    tuneId: string | null
    mime: string
    durationMs: number
    recordedAt: string
    /** Peaks captured live during recording; null when there is nothing to show until the
     * server builds its own, as after recovering a capture the tab never finished. */
    peaks: Uint8Array | null
  },
): Promise<void> {
  await recordingTx(db, async () => {
    const file = await db.recording_files.get(id)
    // A repeat finish, or one after cancelCapture, has nothing left to assemble.
    if (!file || file.local_state !== 'capturing') return
    const chunks = await db.recording_chunks.where('recording_id').equals(id).sortBy('idx')
    const blob = new Blob(
      chunks.map((c) => c.blob),
      { type: fields.mime },
    )
    await db.recording_files.put(
      emptyFile(id, {
        blob,
        mime: fields.mime,
        bytes: blob.size,
        local_duration_ms: fields.durationMs,
        peaks: fields.peaks,
      }),
    )
    await db.recording_chunks.where('recording_id').equals(id).delete()
    await putRecordingRow(db, id, {
      tuneId: fields.tuneId,
      source: 'microphone',
      // Named for when it started, so a recording is never nameless in a list.
      label: defaultRecordingLabel(fields.recordedAt),
      recordedAt: fields.recordedAt,
    })
  })
}

export async function cancelCapture(db: CrosstuneDb, id: string): Promise<void> {
  await recordingTx(db, async () => {
    const file = await db.recording_files.get(id)
    // A file that already finished (or was already cancelled) owns nothing here;
    // deleting it now would orphan the recordings row finishCapture just created.
    if (file && file.local_state !== 'capturing') return
    await db.recording_chunks.where('recording_id').equals(id).delete()
    if (file) await db.recording_files.delete(id)
  })
}

export async function addUploadedFile(
  db: CrosstuneDb,
  file: File,
  fields: { tuneId: string | null; label: string | null; durationMs: number | null },
): Promise<string> {
  const id = newId()
  const mime = file.type || 'application/octet-stream'
  await recordingTx(db, async () => {
    await db.recording_files.put(
      emptyFile(id, { blob: file, mime, bytes: file.size, local_duration_ms: fields.durationMs }),
    )
    await putRecordingRow(db, id, {
      tuneId: fields.tuneId,
      source: 'upload',
      label: fields.label,
      recordedAt: new Date(file.lastModified || Date.now()).toISOString(),
    })
  })
  return id
}

/**
 * Saves a link's audio as a recording of its tune. Only the row is written: the server sees
 * `source: 'import'` on push and fetches the audio itself, so there is no file to upload.
 */
export async function addRecordingFromLink(db: CrosstuneDb, linkId: string): Promise<string> {
  let id = newId()
  await recordingTx(db, async () => {
    const link = await db.recording_links.get(linkId)
    if (!link || link.deleted_at) throw new Error(LINK_NOT_FOUND)
    // A second tap, or another device's push, must not queue a second import of one page.
    const saved = (await activeRecordingsForTune(db, link.tune_id)).find(
      (recording) => recording.origin_url === link.url,
    )
    if (saved) {
      id = saved.id
      return
    }
    await putRecordingRow(db, id, {
      tuneId: link.tune_id,
      source: 'import',
      // The server counts code points, so a cut by UTF-16 unit could split an emoji.
      label: link.title ? [...link.title].slice(0, RECORDING_LIMITS.label).join('') : null,
      recordedAt: now(),
      origin: link.provider,
      originUrl: link.url,
    })
  })
  return id
}

export async function updateRecording(
  db: CrosstuneDb,
  id: string,
  patch: {
    label?: string | null
    tune_id?: string | null
    trim_start_ms?: number
    trim_end_ms?: number | null
    speed_percent?: number
    pitch_cents?: number
  },
): Promise<void> {
  await recordingTx(db, async () => {
    const row = await db.recordings.get(id)
    if (!row || row.deleted_at) throw new Error(RECORDING_NOT_FOUND)
    let position = row.position
    if (patch.tune_id !== undefined && patch.tune_id !== row.tune_id && patch.tune_id) {
      const tune = await db.tunes.get(patch.tune_id)
      if (!tune || tune.deleted_at) throw new Error(TUNE_NOT_FOUND)
      position = nextPosition(await activeRecordingsForTune(db, patch.tune_id))
    }
    await putRow(db, 'recordings', { ...row, ...defined(patch), position, updated_at: now() })
    // The edit re-pushes the row, so a failed upload gets a fresh attempt along with it.
    const file = await db.recording_files.get(id)
    if (file?.local_state === 'failed_upload') {
      await db.recording_files.update(id, { local_state: 'captured', error: null })
    }
  })
}

/** Put a file back in the upload queue with a clean slate: no error, no backoff. */
export async function requeueFile(db: CrosstuneDb, id: string): Promise<void> {
  await db.recording_files.update(id, {
    local_state: 'captured',
    error: null,
    upload_attempts: 0,
    next_attempt_at: null,
  })
}

/** Put a refused or backed-off upload at the front of the queue, so the next pass tries it now. */
export async function retryUpload(db: CrosstuneDb, id: string): Promise<void> {
  await db.transaction('rw', db.recording_files, async () => {
    const file = await db.recording_files.get(id)
    if (file?.local_state !== 'failed_upload' && file?.local_state !== 'captured') return
    await requeueFile(db, id)
  })
}

/** Tombstone a recording with its loops, which the server cascades, and drop its local audio. */
async function tombstoneRecording(
  db: CrosstuneDb,
  id: string,
  at: string,
  options: { enqueueDelete: boolean },
): Promise<void> {
  await tombstone(db, 'recordings', id, at, options)
  await tombstoneWhere(db, 'recording_loops', 'recording_id', id, at)
  await db.recording_files.delete(id)
  await db.recording_chunks.where('recording_id').equals(id).delete()
}

export async function deleteRecording(db: CrosstuneDb, id: string): Promise<void> {
  await recordingTx(db, () => tombstoneRecording(db, id, now(), { enqueueDelete: true }))
}

/** Called inside deleteTune's transaction, which is already widened to the audio tables. */
export async function tombstoneTuneRecordings(
  db: CrosstuneDb,
  tuneId: string,
  at: string,
): Promise<void> {
  const ids = await db.recordings.where('tune_id').equals(tuneId).primaryKeys()
  for (const id of ids) await tombstoneRecording(db, id, at, { enqueueDelete: false })
}

export async function setFileState(
  db: CrosstuneDb,
  id: string,
  state: LocalFileState,
  error: string | null = null,
): Promise<void> {
  await db.recording_files.update(id, { local_state: state, error })
}

export async function storeDownloadedBlob(
  db: CrosstuneDb,
  id: string,
  blob: Blob,
  mime: string,
  rev: string,
  startMs: number,
): Promise<void> {
  await db.transaction('rw', db.recording_files, async () => {
    const file = (await db.recording_files.get(id)) ?? emptyFile(id)
    await db.recording_files.put({
      ...file,
      blob,
      mime,
      bytes: blob.size,
      local_state: 'downloaded',
      error: null,
      blob_rev: rev,
      blob_start_ms: startMs,
    })
  })
}

/** Store a fetched waveform against the revision it was built for. */
export async function storePeaks(
  db: CrosstuneDb,
  id: string,
  peaks: Uint8Array,
  rev: string,
): Promise<void> {
  await db.transaction('rw', db.recording_files, async () => {
    const file = (await db.recording_files.get(id)) ?? emptyFile(id)
    await db.recording_files.put({ ...file, peaks, peaks_rev: rev })
  })
}

/** Drop cached audio that can be fetched again. Only a blob the server can
 * actually serve back (its recording is `ready`) exists anywhere else; a recording
 * still queued, blocked, failed, or not yet transcoded is the only copy. */
export async function clearDownloadedBlobs(db: CrosstuneDb): Promise<void> {
  await db.transaction('rw', db.recording_files, db.recordings, async () => {
    // Keys only, so the blobs being dropped are never read.
    const ids = await db.recording_files
      .where('local_state')
      .anyOf(['uploaded', 'downloaded'])
      .primaryKeys()
    const rows = await db.recordings.bulkGet(ids)
    for (const [i, id] of ids.entries()) {
      const row = rows[i]
      if (!row || row.deleted_at || row.state !== 'ready') continue
      await db.recording_files.update(id, { blob: null, bytes: 0 })
    }
  })
}

export async function localAudioBytes(db: CrosstuneDb): Promise<number> {
  let bytes = 0
  // A cursor over the blob-bearing rows only, rather than materializing the whole table:
  // there is no index for "has a blob", so this still visits every row, but never holds
  // more than one in memory at a time.
  await db.recording_files
    .filter((f) => f.blob !== null)
    .each((f) => {
      bytes += f.bytes
    })
  return bytes
}
