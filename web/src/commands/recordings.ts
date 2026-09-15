import {
  getKeepOfflineLists,
  getKeepOfflineSongs,
  setKeepOfflineLists,
  setKeepOfflineSongs,
} from '../db/meta'
import type { LocalFileState, RecordingFile } from '../db/recordings'
import type { CrosstuneDb } from '../db/schema'
import type { LocalRecording } from '../db/types'
import { activeByPosition, newId, nextPosition, now, putRow, recordingTx, tombstone } from './write'

function emptyFile(id: string, overrides: Partial<RecordingFile> = {}): RecordingFile {
  return {
    id,
    blob: null,
    mime: null,
    bytes: 0,
    local_duration_ms: null,
    local_state: 'captured',
    pinned: false,
    error: null,
    last_chunk_at: null,
    song_id: null,
    recorded_at: null,
    next_attempt_at: null,
    upload_attempts: 0,
    ...overrides,
  }
}

export function activeRecordingsForSong(
  db: CrosstuneDb,
  songId: string,
): Promise<LocalRecording[]> {
  return db.recordings.where('song_id').equals(songId).toArray().then(activeByPosition)
}

async function putRecordingRow(
  db: CrosstuneDb,
  id: string,
  fields: {
    songId: string | null
    source: 'microphone' | 'upload'
    label: string | null
    recordedAt: string
  },
): Promise<void> {
  const at = now()
  const siblings = fields.songId ? await activeRecordingsForSong(db, fields.songId) : []
  await putRow(db, 'recordings', {
    id,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    server_seq: 0,
    song_id: fields.songId,
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
  take: { songId: string | null; recordedAt: string },
): Promise<void> {
  await db.recording_files.put(
    emptyFile(id, {
      local_state: 'capturing',
      last_chunk_at: Date.now(),
      song_id: take.songId,
      recorded_at: take.recordedAt,
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

export async function finishCapture(
  db: CrosstuneDb,
  id: string,
  fields: { songId: string | null; mime: string; durationMs: number; recordedAt: string },
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
      songId: fields.songId,
      source: 'microphone',
      label: null,
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
  fields: { songId: string | null; label: string | null },
): Promise<string> {
  const id = newId()
  const mime = file.type || 'application/octet-stream'
  await recordingTx(db, async () => {
    await db.recording_files.put(emptyFile(id, { blob: file, mime, bytes: file.size }))
    await putRecordingRow(db, id, {
      songId: fields.songId,
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
  patch: { label?: string | null; song_id?: string | null },
): Promise<void> {
  await recordingTx(db, async () => {
    const row = await db.recordings.get(id)
    if (!row || row.deleted_at) throw new Error('Recording not found')
    let position = row.position
    if (patch.song_id !== undefined && patch.song_id !== row.song_id && patch.song_id) {
      const song = await db.songs.get(patch.song_id)
      if (!song || song.deleted_at) throw new Error('Song not found')
      position = nextPosition(await activeRecordingsForSong(db, patch.song_id))
    }
    await putRow(db, 'recordings', {
      ...row,
      label: patch.label === undefined ? row.label : patch.label,
      song_id: patch.song_id === undefined ? row.song_id : patch.song_id,
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

/** Put a failed upload back in the queue; the caller starts a sync to send it. */
export async function retryUpload(db: CrosstuneDb, id: string): Promise<void> {
  await db.transaction('rw', db.recording_files, async () => {
    const file = await db.recording_files.get(id)
    if (file?.local_state !== 'failed_upload') return
    await db.recording_files.update(id, { local_state: 'captured', error: null })
  })
}

export async function deleteRecording(db: CrosstuneDb, id: string): Promise<void> {
  await recordingTx(db, async () => {
    await tombstone(db, 'recordings', id, now())
    await db.recording_files.delete(id)
    await db.recording_chunks.where('recording_id').equals(id).delete()
  })
}

/** Called inside deleteSong's transaction, which is already widened to the audio tables. */
export async function tombstoneSongRecordings(
  db: CrosstuneDb,
  songId: string,
  at: string,
): Promise<void> {
  const rows = await db.recordings.where('song_id').equals(songId).toArray()
  for (const row of rows) {
    await tombstone(db, 'recordings', row.id, at, { enqueueDelete: false })
    await db.recording_files.delete(row.id)
    await db.recording_chunks.where('recording_id').equals(row.id).delete()
  }
}

export async function setPinned(db: CrosstuneDb, ids: string[], pinned: boolean): Promise<void> {
  await db.transaction('rw', db.recording_files, async () => {
    const files = await db.recording_files.bulkGet(ids)
    await db.recording_files.bulkPut(
      ids.map((id, i) => {
        const file = files[i]
        // A recording pulled from another device has no file row until it is pinned or played.
        return file ? { ...file, pinned } : emptyFile(id, { pinned, local_state: 'downloaded' })
      }),
    )
  })
}

function withMark(ids: string[], id: string, on: boolean): string[] {
  return on ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((existing) => existing !== id)
}

/** Marks a song so every ready recording under it downloads ahead of a jam and stays
 * cached, independent of any per-recording pin. */
export async function setSongKeepOffline(
  db: CrosstuneDb,
  songId: string,
  on: boolean,
): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await setKeepOfflineSongs(db, withMark(await getKeepOfflineSongs(db), songId, on))
  })
}

/** Marks a list so every song added to it, now or later, is kept offline too. */
export async function setListKeepOffline(
  db: CrosstuneDb,
  listId: string,
  on: boolean,
): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await setKeepOfflineLists(db, withMark(await getKeepOfflineLists(db), listId, on))
  })
}

/** The songs a list's live entries resolve to, one hop through each entry's user song. */
export async function songIdsInList(db: CrosstuneDb, listId: string): Promise<Set<string>> {
  const items = await db.list_items.where('list_id').equals(listId).toArray()
  const userSongs = await db.user_songs.bulkGet(
    items.filter((i) => !i.deleted_at).map((i) => i.user_song_id),
  )
  const ids = new Set<string>()
  for (const userSong of userSongs) {
    if (userSong && !userSong.deleted_at) ids.add(userSong.song_id)
  }
  return ids
}

/** Song ids kept offline directly, or through a marked list, computed once so a pass over
 * many recordings does not re-read the marks or re-walk list membership per row. */
export async function keptOfflineSongIds(db: CrosstuneDb): Promise<Set<string>> {
  const [markedSongs, markedLists] = await Promise.all([
    getKeepOfflineSongs(db),
    getKeepOfflineLists(db),
  ])
  const covered = new Set(markedSongs)
  for (const listId of markedLists) {
    for (const songId of await songIdsInList(db, listId)) covered.add(songId)
  }
  return covered
}

/** True when a recording's blob belongs on this device: it is pinned itself, its song is
 * marked, or its song's user song sits in a marked list. */
export async function isKeptOffline(
  db: CrosstuneDb,
  recording: { id: string; song_id: string | null },
): Promise<boolean> {
  const file = await db.recording_files.get(recording.id)
  if (file?.pinned) return true
  if (!recording.song_id) return false
  return (await keptOfflineSongIds(db)).has(recording.song_id)
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

/** Drop cached audio the user has not asked to keep. Only a blob the server can
 * actually serve back (its recording is `ready`) exists anywhere else; a take
 * still queued, blocked, failed, or not yet transcoded is the only copy. */
export async function clearUnpinnedBlobs(db: CrosstuneDb): Promise<void> {
  await db.transaction(
    'rw',
    db.recording_files,
    db.recordings,
    db.meta,
    db.list_items,
    db.user_songs,
    async () => {
      const covered = await keptOfflineSongIds(db)
      const candidates = await db.recording_files
        .filter(
          (f) => !f.pinned && (f.local_state === 'uploaded' || f.local_state === 'downloaded'),
        )
        .toArray()
      for (const file of candidates) {
        const row = await db.recordings.get(file.id)
        if (!row || row.deleted_at || row.state !== 'ready') continue
        if (row.song_id && covered.has(row.song_id)) continue
        await db.recording_files.update(file.id, { blob: null, bytes: 0 })
      }
    },
  )
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
