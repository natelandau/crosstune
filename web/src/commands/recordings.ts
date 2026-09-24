import type { LocalFileState, RecordingFile } from '../db/recordings'
import type { CrosstuneDb } from '../db/schema'
import type { LocalRecording } from '../db/types'
import { RECORDING_NOT_FOUND, TUNE_NOT_FOUND } from './messages'
import { activeByPosition, newId, nextPosition, now, putRow, recordingTx, tombstone } from './write'

function emptyFile(id: string, overrides: Partial<RecordingFile> = {}): RecordingFile {
  return {
    id,
    blob: null,
    mime: null,
    bytes: 0,
    local_duration_ms: null,
    local_state: 'captured',
    error: null,
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
    source: 'microphone' | 'upload'
    label: string | null
    recordedAt: string
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
    recorded_at: fields.recordedAt,
    position: nextPosition(siblings),
    state: 'pending_upload',
    duration_ms: null,
    playback_mime: null,
    playback_bytes: null,
    error: null,
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
  fields: { tuneId: string | null; mime: string; durationMs: number; recordedAt: string },
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
  fields: { tuneId: string | null; label: string | null },
): Promise<string> {
  const id = newId()
  const mime = file.type || 'application/octet-stream'
  await recordingTx(db, async () => {
    await db.recording_files.put(emptyFile(id, { blob: file, mime, bytes: file.size }))
    await putRecordingRow(db, id, {
      tuneId: fields.tuneId,
      source: 'upload',
      label: fields.label,
      recordedAt: new Date(file.lastModified || Date.now()).toISOString(),
    })
  })
  return id
}

export async function updateRecording(
  db: CrosstuneDb,
  id: string,
  patch: { label?: string | null; tune_id?: string | null },
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
    await putRow(db, 'recordings', {
      ...row,
      label: patch.label === undefined ? row.label : patch.label,
      tune_id: patch.tune_id === undefined ? row.tune_id : patch.tune_id,
      position,
      updated_at: now(),
    })
    // The edit re-pushes the row, so a failed upload gets a fresh attempt along with it.
    const file = await db.recording_files.get(id)
    if (file?.local_state === 'failed_upload') {
      await db.recording_files.update(id, { local_state: 'captured', error: null })
    }
  })
}

/** Put a refused or backed-off upload at the front of the queue, so the next pass tries it now. */
export async function retryUpload(db: CrosstuneDb, id: string): Promise<void> {
  await db.transaction('rw', db.recording_files, async () => {
    const file = await db.recording_files.get(id)
    if (file?.local_state !== 'failed_upload' && file?.local_state !== 'captured') return
    await db.recording_files.update(id, {
      local_state: 'captured',
      error: null,
      upload_attempts: 0,
      next_attempt_at: null,
    })
  })
}

export async function deleteRecording(db: CrosstuneDb, id: string): Promise<void> {
  await recordingTx(db, async () => {
    await tombstone(db, 'recordings', id, now())
    await db.recording_files.delete(id)
    await db.recording_chunks.where('recording_id').equals(id).delete()
  })
}

/** Called inside deleteTune's transaction, which is already widened to the audio tables. */
export async function tombstoneTuneRecordings(
  db: CrosstuneDb,
  tuneId: string,
  at: string,
): Promise<void> {
  const rows = await db.recordings.where('tune_id').equals(tuneId).toArray()
  for (const row of rows) {
    await tombstone(db, 'recordings', row.id, at, { enqueueDelete: false })
    await db.recording_files.delete(row.id)
    await db.recording_chunks.where('recording_id').equals(row.id).delete()
  }
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
    })
  })
}

/** Drop cached audio that can be fetched again. Only a blob the server can
 * actually serve back (its recording is `ready`) exists anywhere else; a recording
 * still queued, blocked, failed, or not yet transcoded is the only copy. */
export async function clearDownloadedBlobs(db: CrosstuneDb): Promise<void> {
  await db.transaction('rw', db.recording_files, db.recordings, async () => {
    const candidates = await db.recording_files
      .filter((f) => f.local_state === 'uploaded' || f.local_state === 'downloaded')
      .toArray()
    const rows = await db.recordings.bulkGet(candidates.map((f) => f.id))
    for (const [i, file] of candidates.entries()) {
      const row = rows[i]
      if (!row || row.deleted_at || row.state !== 'ready') continue
      await db.recording_files.update(file.id, { blob: null, bytes: 0 })
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
