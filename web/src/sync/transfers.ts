import { ApiError, NetworkError } from '../api/client'
import type { SyncApi } from '../api/types'
import {
  cancelCapture,
  finishCapture,
  setFileState,
  storeDownloadedBlob,
} from '../commands/recordings'
import { now, putRow, recordingTx } from '../commands/write'
import { baseContentType, CHUNK_MS, isNotUploaded, type LocalFileState } from '../db/recordings'
import { getKeepOffline, getStorage, setStorage } from '../db/meta'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { liveTune } from '../db/tunes'
import { defaultLocks, heldCaptureIds } from './captureLock'
import { isAuthFailure } from './errors'

export const QUOTA_PROBLEM = 'urn:crosstune:quota-exceeded'

// Without a lock manager, a capture stops sending chunks as soon as the recorder does, so
// a gap this wide means the tab (or the recorder inside it) is gone, not just between chunks.
export const STALE_CAPTURE_MS = 6 * CHUNK_MS

// With a lock manager, a row not on the held list is never live, so a much shorter gap
// (covering the window between a chunk landing and the next one starting) is enough.
export const CAPTURE_LOCK_GRACE_MS = 2 * CHUNK_MS

/** A capture whose chunks stopped arriving a while ago: finish it from what it has so no audio is lost. */
export async function recoverInterruptedCaptures(
  db: CrosstuneDb,
  now: number = Date.now(),
  locks: LockManager | undefined = defaultLocks(),
): Promise<void> {
  const capturing = await db.recording_files.where('local_state').equals('capturing').toArray()
  const held = await heldCaptureIds(locks)
  const staleAfter = held ? CAPTURE_LOCK_GRACE_MS : STALE_CAPTURE_MS
  for (const file of capturing) {
    // A held lock means the recorder that owns this capture is still alive, in this tab
    // or another, regardless of how long it has been since its last chunk landed.
    if (held?.has(file.id)) continue
    const fresh = typeof file.last_chunk_at === 'number' && now - file.last_chunk_at < staleAfter
    if (fresh) continue
    const chunks = await db.recording_chunks.where('recording_id').equals(file.id).sortBy('idx')
    if (chunks.length === 0) {
      await cancelCapture(db, file.id)
      continue
    }
    const tune = file.tune_id ? await db.tunes.get(file.tune_id) : undefined
    await finishCapture(db, file.id, {
      tuneId: liveTune(tune)?.id ?? null,
      mime: chunks[0]!.blob.type || 'audio/mp4',
      // The recorder never reported a duration for a recording this abandoned, so the chunk
      // count is the only record of how long it ran.
      durationMs: file.local_duration_ms ?? chunks.length * CHUNK_MS,
      recordedAt: file.recorded_at ?? new Date().toISOString(),
    })
  }
}

// Doubles with each consecutive transient failure, capped so a long outage still retries hourly-ish.
const RETRY_BASE_MS = 30_000
const RETRY_MAX_MS = 30 * 60_000

/** How long a transfer that failed `attempts` times in a row waits before the next try. */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempts)
}

/** A transient failure goes back to captured for the next pass, but not before a backoff
 * that doubles with each consecutive miss, so a persistent error does not resend the same
 * blob on every pass. The row keeps the reason, so a recording that keeps waiting can say why. */
async function scheduleRetry(db: CrosstuneDb, id: string, cause: unknown): Promise<void> {
  const file = await db.recording_files.get(id)
  const attempts = file?.upload_attempts ?? 0
  const delay = retryDelayMs(attempts)
  await db.recording_files.update(id, {
    local_state: 'captured',
    error: cause instanceof Error ? cause.message : String(cause),
    upload_attempts: attempts + 1,
    next_attempt_at: Date.now() + delay,
  })
}

/** Leave the retry loop, win or lose: a state outside it (uploaded, blocked, failed) starts fresh. */
async function settleUpload(
  db: CrosstuneDb,
  id: string,
  state: LocalFileState,
  error: string | null = null,
): Promise<void> {
  await db.recording_files.update(id, {
    local_state: state,
    error,
    upload_attempts: 0,
    next_attempt_at: null,
  })
}

async function uploadOne(db: CrosstuneDb, api: SyncApi, id: string): Promise<void> {
  const file = await db.recording_files.get(id)
  if (!file?.blob) return
  const row = await db.recordings.get(id)
  // A tombstone that lands mid-pass is settled by the next pass's dropTombstonedFiles.
  if (!row || row.deleted_at) return
  // The row must exist on the server before it can be given a slot.
  if (await pendingFor(db, 'recordings', id)) return
  if (row.state !== 'pending_upload') {
    await settleUpload(db, id, 'uploaded')
    return
  }
  await setFileState(db, id, 'uploading')
  const contentType = baseContentType(file.mime ?? file.blob.type)

  let slot
  try {
    slot = await api.requestUploadSlot(id, { bytes: file.blob.size, content_type: contentType })
  } catch (error) {
    if (error instanceof ApiError && error.problemType === QUOTA_PROBLEM) {
      await settleUpload(db, id, 'blocked_quota', error.message)
      return
    }
    if (error instanceof ApiError && error.status === 409) {
      // Already past pending on the server, so a previous confirmation landed.
      await settleUpload(db, id, 'uploaded')
      return
    }
    if (error instanceof ApiError && error.status === 404) {
      // The server has no live row for this recording; pushing it again gives the slot request one.
      await requeueRecording(db, id)
      return
    }
    if (
      error instanceof ApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      ![401, 403, 408, 429].includes(error.status)
    ) {
      // A refusal of the request itself (bad mime, too large) will never succeed
      // as-is; an auth, timeout, or rate-limit refusal might on retry.
      await settleUpload(db, id, 'failed_upload', error.message)
      return
    }
    // Everything else (5xx, 401/403/408/429, network and auth failures, a transfer error) is transient.
    await scheduleRetry(db, id, error)
    throw error
  }

  try {
    await api.putObject(slot.url, file.blob, contentType)
    await api.uploadFinished(id)
    await settleUpload(db, id, 'uploaded')
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // The slot expired or the object never landed; the next pass requests a fresh one.
      await scheduleRetry(db, id, error)
      return
    }
    if (error instanceof ApiError && error.status === 413) {
      // The server deleted the object because it did not match the declared size.
      await settleUpload(db, id, 'failed_upload', error.message)
      return
    }
    await scheduleRetry(db, id, error)
    throw error
  }
}

/** Queue the recording row again with a fresh timestamp and put its file back in the upload queue. */
async function requeueRecording(db: CrosstuneDb, id: string): Promise<void> {
  await recordingTx(db, async () => {
    const row = await db.recordings.get(id)
    if (row && !row.deleted_at) await putRow(db, 'recordings', { ...row, updated_at: now() })
    await db.recording_files.update(id, {
      local_state: 'captured',
      error: null,
      upload_attempts: 0,
      next_attempt_at: null,
    })
  })
}

/** Remove a file row (and its chunks) whose recording was tombstoned elsewhere, and any
 * chunk left with no file row or one that has moved past capturing. A capture still in
 * progress is left alone: it has no server row to check against yet, and still needs its chunks.
 * A tombstoned recording that never uploaded is restored as unfiled instead: the server takes a
 * newer upsert over its tombstone, and this blob is the only copy of the audio. */
async function dropTombstonedFiles(db: CrosstuneDb): Promise<void> {
  await recordingTx(db, async () => {
    const files = await db.recording_files.filter((f) => f.local_state !== 'capturing').toArray()
    const rows = await db.recordings.bulkGet(files.map((f) => f.id))
    for (const [i, file] of files.entries()) {
      const row = rows[i]
      if (row && !row.deleted_at) continue
      if (row && file.blob && isNotUploaded(file)) {
        await putRow(db, 'recordings', {
          ...row,
          deleted_at: null,
          tune_id: null,
          updated_at: now(),
        })
        await db.recording_files.update(file.id, { local_state: 'captured', error: null })
        continue
      }
      await db.recording_files.delete(file.id)
      await db.recording_chunks.where('recording_id').equals(file.id).delete()
    }

    // Read the owners off the primary keys rather than a unique-direction index cursor,
    // which Safari's IndexedDB refuses to open ("Unable to open cursor").
    const chunkKeys = await db.recording_chunks.toCollection().primaryKeys()
    const chunkOwners = [...new Set(chunkKeys.map(([recordingId]) => recordingId))]
    const owners = await db.recording_files.bulkGet(chunkOwners)
    for (const [i, recordingId] of chunkOwners.entries()) {
      if (owners[i]?.local_state === 'capturing') continue
      await db.recording_chunks.where('recording_id').equals(recordingId).delete()
    }
  })
}

/**
 * Upload every captured blob whose row has reached the server. Blocked and stalled ones
 * are retried too. A row's own transient failure does not stop the rest of the pass; the
 * first one is returned (null when every row settled) so the caller can still fail the sync.
 */
export async function uploadPass(db: CrosstuneDb, api: SyncApi): Promise<unknown> {
  // Run before the quota skip below, so a blocked row whose recording was deleted
  // elsewhere is cleaned up instead of being skipped forever by the figures check.
  await dropTombstonedFiles(db)

  const waiting = await db.recording_files
    .where('local_state')
    .anyOf(['captured', 'blocked_quota', 'uploading'])
    .toArray()
  const storage = await getStorage(db)
  const nowMs = Date.now()
  let firstError: unknown = null
  for (const file of waiting) {
    // A pass is the only place a blocked row is reconsidered, so re-check the figures
    // rather than hammering the server with a slot request that will fail again.
    if (
      file.local_state === 'blocked_quota' &&
      storage &&
      storage.used_bytes + file.bytes > storage.quota_bytes
    ) {
      continue
    }
    if (file.next_attempt_at !== null && file.next_attempt_at > nowMs) continue
    try {
      await uploadOne(db, api, file.id)
    } catch (error) {
      // Only an auth failure stops the whole pass; every other failure, including one
      // that never reached the network, is this row's problem alone and must not
      // block pull or the rest of the queue.
      if (isAuthFailure(error)) throw error
      firstError ??= error
    }
  }
  return firstError
}

/** A stale 'downloading' row is a prior attempt that never finished, not a state to
 * restore as-is: treat it the same as a completed fetch that produced no blob. */
function restingState(state: LocalFileState): LocalFileState {
  return state === 'downloading' ? 'downloaded' : state
}

export async function downloadOne(db: CrosstuneDb, api: SyncApi, id: string): Promise<Blob | null> {
  const file = await db.recording_files.get(id)
  if (file?.blob) return file.blob
  const row = await db.recordings.get(id)
  if (!row || row.deleted_at || row.state !== 'ready') return null
  const previousState = file ? restingState(file.local_state) : null
  await setFileState(db, id, 'downloading')
  try {
    const signed = await api.downloadUrl(id)
    const blob = await api.getObject(signed.url)
    await storeDownloadedBlob(db, id, blob, row.playback_mime ?? blob.type)
    return blob
  } catch (error) {
    // A row that had no state before downloading gets none back; setFileState no-ops on it.
    if (previousState) await setFileState(db, id, previousState)
    throw error
  }
}

export interface DownloadRetries {
  isWaiting(id: string): boolean
  failed(id: string): void
  succeeded(id: string): void
}

/** When the download pass may next try each recording whose download failed, backing off as
 * uploads do so a lasting error is not re-sent after every sync. Kept in memory: a reload
 * tries each once more, and a Play tap fetches regardless. */
export function createDownloadRetries(now: () => number = Date.now): DownloadRetries {
  const waits = new Map<string, { attempts: number; until: number }>()
  return {
    isWaiting: (id) => {
      const wait = waits.get(id)
      return wait !== undefined && now() < wait.until
    },
    failed: (id) => {
      const attempts = waits.get(id)?.attempts ?? 0
      waits.set(id, { attempts: attempts + 1, until: now() + retryDelayMs(attempts) })
    },
    succeeded: (id) => {
      waits.delete(id)
    },
  }
}

/** When the device keeps recordings offline, fetch audio for every ready recording that is
 * not already here. `fetch` lets the caller share one in-flight download per recording with
 * any other path that fetches. */
export async function downloadPass(
  db: CrosstuneDb,
  api: SyncApi,
  fetch: (id: string) => Promise<Blob | null> = (id) => downloadOne(db, api, id),
  retries: DownloadRetries = createDownloadRetries(),
): Promise<void> {
  if (!(await getKeepOffline(db))) return
  const rows = await db.recordings.filter((r) => !r.deleted_at && r.state === 'ready').toArray()
  const files = await db.recording_files.bulkGet(rows.map((r) => r.id))
  for (const [i, row] of rows.entries()) {
    const file = files[i]
    if (file?.blob || retries.isWaiting(row.id)) continue
    try {
      await fetch(row.id)
      retries.succeeded(row.id)
    } catch (error) {
      // Offline and auth failures stop the whole pass; anything else is this row's
      // problem alone, so record it and let the rest of the kept-offline set still download.
      if (error instanceof NetworkError || isAuthFailure(error)) {
        throw error
      }
      retries.failed(row.id)
      if (file) {
        const message = error instanceof Error ? error.message : String(error)
        await setFileState(db, row.id, restingState(file.local_state), message)
      }
    }
  }
}

export async function refreshStorage(db: CrosstuneDb, api: SyncApi): Promise<void> {
  const me = await api.me()
  await setStorage(db, me.storage)
}
