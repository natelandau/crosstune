import * as Sentry from '@sentry/react'
import { recordingsPlayable } from '../billing/plan'
import { readPlan } from '../billing/entitlement'
import type { AnalyticsClient } from '../usage/client'
import { bytesBucket } from '../usage/buckets'
import { failureReason } from '../usage/failure'
import { recordingOrigin } from '../usage/origin'
import { ApiError, NetworkError, NoTokenError, TransferError } from '../api/client'
import type { ReadBody, SyncApi } from '../api/types'
import { AUDIO_BITRATES } from '../constants'
import {
  cancelCapture,
  finishCapture,
  requeueFile,
  setFileState,
  joinCapturedChunks,
  storeDownloadedBlob,
  storePeaks,
  waitingParentIds,
} from '../commands/recordings'
import { now, putRow, recordingTx } from '../commands/write'
import {
  baseContentType,
  CHUNK_MS,
  HANDOFF_TAKE_BACK_ATTEMPTS,
  deleteChunks,
  hasLocalAudio,
  holdsChunkedAudio,
  isNotUploaded,
  modifyWhileHeld,
  readLocalAudio,
  type HandedOffFile,
  type LocalFileState,
  type RecordingFile,
  type UploadHandoff,
} from '../db/recordings'
import {
  getKeepOffline,
  getStorage,
  setDownloadsHeldForSpace,
  setCountryCenter,
  setStorage,
  type StorageUsage,
} from '../db/meta'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { liveTune } from '../db/tunes'
import type { LocalRecording } from '../db/types'
import {
  holdsSplitAudio,
  MAX_RECORDING_MS,
  mustSplitToUpload,
  type UploadLimits,
} from '../domain/recordingLimits'
import { BACKGROUND_UPLOAD_MAX_BYTES, type BackgroundUploads } from '../platform/backgroundSync'
import { storageHeadroom } from '../platform/storage'
import { defaultLocks, heldCaptureIds } from './captureLock'
import { isAuthFailure, isPlanRefusal, isRetryableRefusal, QUOTA_PROBLEM } from './errors'

export { QUOTA_PROBLEM }

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
      // The tab that held this capture is gone, so nothing here ever sampled a waveform.
      peaks: null,
    })
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    error: errorText(cause),
    upload_attempts: attempts + 1,
    next_attempt_at: Date.now() + delay,
  })
}

/** What an upload pass reports, with the files whose consecutive failures it has reported. */
export interface UploadReports {
  /** A retried failed attempt: sent once per run of consecutive failures, never while offline. */
  failed(row: LocalRecording, cause: unknown): void
  /** A permanent refusal: always sent (unless offline), and ends the consecutive failures. */
  refused(row: LocalRecording, cause: unknown): void
  /** A file that settled or left the queue ends its consecutive failures. */
  ended(id: string): void
  storageLimit(db: CrosstuneDb): Promise<void>
}

export function createUploadReports(
  analytics: AnalyticsClient,
  isOnline: () => boolean = () => navigator.onLine,
): UploadReports {
  const reportedFailures = new Set<string>()
  const send = (row: LocalRecording, cause: unknown): boolean => {
    // Offline is expected, not friction; the same test the transfer loop applies.
    if (!isOnline() || cause instanceof NoTokenError) return false
    analytics.send('upload_failed', {
      failure_reason: failureReason(cause),
      origin: recordingOrigin(row),
    })
    return true
  }
  return {
    failed(row, cause) {
      if (reportedFailures.has(row.id)) return
      if (send(row, cause)) reportedFailures.add(row.id)
    },
    refused(row, cause) {
      reportedFailures.delete(row.id)
      send(row, cause)
    },
    ended: (id) => void reportedFailures.delete(id),
    // Without storage usage nothing is sent, since a guessed use would land in the wrong bucket.
    async storageLimit(db) {
      try {
        const storage = await getStorage(db)
        if (storage) {
          analytics.send('storage_limit_reached', { storage_used: bytesBucket(storage.used_bytes) })
        }
      } catch (error) {
        Sentry.captureException(error)
      }
    },
  }
}

/** Leave the retry loop, win or lose: a state outside it (uploaded, blocked, failed) starts fresh. */
async function settleUpload(
  db: CrosstuneDb,
  reports: UploadReports,
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
  reports.ended(id)
}

/** Whether the service worker may send this file: small enough to read into memory there,
 * and not a split parent, whose upload the server holds to the larger split cap. */
function workerMaySend(row: LocalRecording, file: RecordingFile): boolean {
  return (
    file.bytes <= BACKGROUND_UPLOAD_MAX_BYTES &&
    row.split_id == null &&
    (file.local_duration_ms ?? 0) <= MAX_RECORDING_MS
  )
}

/** A hand-off the worker may still finish: its slot has not expired, the server has not
 * refused its confirm, and its runs have not failed too often. */
export function isLiveHandoff(
  file: RecordingFile | undefined,
  nowMs: number,
): file is HandedOffFile {
  const handoff = file?.handoff
  return (
    handoff != null &&
    !handoff.refused &&
    handoff.expires_at > nowMs &&
    handoff.attempts < HANDOFF_TAKE_BACK_ATTEMPTS
  )
}

/** Whether the page sends this file itself, under a plan with recordings: no live hand-off
 * leaves it to the worker, and it is not held for a split. */
export function pageWouldUpload(
  row: LocalRecording | undefined,
  file: RecordingFile,
  storage: UploadLimits | null,
  nowMs: number,
): boolean {
  return !isLiveHandoff(file, nowMs) && !(row && mustSplitToUpload(row, file, storage))
}

/** The files in `states` with their rows and the account's storage usage, or null under a
 * plan whose recordings the page does not upload. */
export async function readUploadQueue(
  db: CrosstuneDb,
  states: LocalFileState[],
): Promise<{
  files: RecordingFile[]
  rows: (LocalRecording | undefined)[]
  storage: StorageUsage | null
} | null> {
  if (!recordingsPlayable(await readPlan(db, new Date()))) return null
  const files = await db.recording_files.where('local_state').anyOf(states).toArray()
  const rows = await db.recordings.bulkGet(files.map((file) => file.id))
  return { files, rows, storage: await getStorage(db) }
}

/** Clear a hand-off only while the row still holds it, so a worker run that settled it first
 * keeps its result. False when the row no longer holds it. */
async function takeBackHandoff(
  db: CrosstuneDb,
  id: string,
  handoff: UploadHandoff,
  change: Partial<RecordingFile> = {},
): Promise<boolean> {
  const changed = await modifyWhileHeld(db.recording_files, id, handoff, (row) => {
    Object.assign(row, change, { handoff: null })
  })
  return changed > 0
}

/** Resolves to the hand-off when the file was left for the service worker to send.
 * `background` is set only when the worker may take this file. */
async function uploadOne(
  db: CrosstuneDb,
  api: SyncApi,
  reports: UploadReports,
  id: string,
  background?: BackgroundUploads,
): Promise<UploadHandoff | undefined> {
  const file = await db.recording_files.get(id)
  if (!hasLocalAudio(file)) return
  // Another tab's pass may have handed it off since this pass read the queue.
  if (isLiveHandoff(file, Date.now())) return
  const row = await db.recordings.get(id)
  // A tombstone that lands mid-pass is settled by the next pass's dropTombstonedFiles.
  if (!row || row.deleted_at) return
  // The row must exist on the server before it can be given a slot.
  if (await pendingFor(db, 'recordings', id)) return
  if (row.state !== 'pending_upload') {
    await settleUpload(db, reports, id, 'uploaded')
    return
  }
  const blob = (await readLocalAudio(db, file))!
  await setFileState(db, id, 'uploading')
  const contentType = baseContentType(file.mime ?? blob.type)

  let slot
  try {
    slot = await api.requestUploadSlot(id, { bytes: blob.size, content_type: contentType })
  } catch (error) {
    if (isPlanRefusal(error)) {
      await db.recording_files.update(id, { local_state: file.local_state, error: file.error })
      throw error
    }
    if (error instanceof ApiError) {
      if (error.problemType === QUOTA_PROBLEM) {
        await settleUpload(db, reports, id, 'blocked_quota', error.message)
        // A blocked file refused again is still the one limit.
        if (file.local_state !== 'blocked_quota') await reports.storageLimit(db)
        return
      }
      if (error.status === 409) {
        // Already past pending on the server, so a previous confirmation landed.
        await settleUpload(db, reports, id, 'uploaded')
        return
      }
      if (error.status === 404) {
        // The server has no live row for this recording; pushing it again gives the slot request one.
        await requeueRecording(db, id)
        reports.ended(id)
        return
      }
      if (!isRetryableRefusal(error)) {
        // A refusal of the request itself (bad mime, too large) will never succeed as-is.
        await settleUpload(db, reports, id, 'failed_upload', error.message)
        reports.refused(row, error)
        return
      }
    }
    // Everything else (5xx, 401/403/408/429, network and auth failures, a transfer error) is transient.
    await scheduleRetry(db, id, error)
    reports.failed(row, error)
    throw error
  }

  if (background && workerMaySend(row, file)) {
    const handoff: UploadHandoff = {
      url: slot.url,
      confirm_token: slot.confirm_token,
      content_type: contentType,
      expires_at: Date.parse(slot.expires_at),
      attempts: 0,
    }
    // The worker owns the upload now, so earlier page failures no longer describe it.
    await db.recording_files.update(id, {
      local_state: 'uploading',
      handoff,
      error: null,
      upload_attempts: 0,
      next_attempt_at: null,
    })
    reports.ended(id)
    return handoff
  }

  try {
    await api.putObject(slot.url, blob, contentType)
    await api.uploadFinished(id)
    await settleUpload(db, reports, id, 'uploaded')
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 409) {
        // The slot expired or the object never landed; the next pass requests a fresh one.
        await scheduleRetry(db, id, error)
        reports.failed(row, error)
        return
      }
      if (error.status === 413) {
        // The server deleted the object because it did not match the declared size.
        await settleUpload(db, reports, id, 'failed_upload', error.message)
        reports.refused(row, error)
        return
      }
    }
    await scheduleRetry(db, id, error)
    reports.failed(row, error)
    throw error
  }
}

/** Queue the recording row again with a fresh timestamp and put its file back in the upload queue. */
async function requeueRecording(db: CrosstuneDb, id: string): Promise<void> {
  await recordingTx(db, async () => {
    const row = await db.recordings.get(id)
    if (row && !row.deleted_at) await putRow(db, 'recordings', { ...row, updated_at: now() })
    await requeueFile(db, id)
  })
}

/** Remove a file row (and its chunks) whose recording was tombstoned elsewhere, and any
 * chunk left with no file row or one whose file holds no chunked audio. A capture still in
 * progress is left alone: it has no server row to check against yet, and still needs its chunks.
 * A tombstoned recording that never uploaded is restored as unfiled instead: the server takes a
 * newer upsert over its tombstone, and this blob is the only copy of the audio. */
async function dropTombstonedFiles(db: CrosstuneDb, reports: UploadReports): Promise<void> {
  await recordingTx(db, async () => {
    // Keys only: a file row carries its audio and peaks, and only an orphan needs them read.
    const ids = await db.recording_files.where('local_state').noneOf(['capturing']).primaryKeys()
    const rows = await db.recordings.bulkGet(ids)
    const orphans = ids.flatMap((id, i) => {
      const row = rows[i]
      return row && !row.deleted_at ? [] : [{ id, row }]
    })
    const files = await db.recording_files.bulkGet(orphans.map((o) => o.id))
    const waiting = orphans.length > 0 ? await waitingParentIds(db) : new Set<string>()
    for (const [i, { id, row }] of orphans.entries()) {
      const file = files[i]
      if (row && hasLocalAudio(file) && isNotUploaded(file)) {
        await putRow(db, 'recordings', {
          ...row,
          deleted_at: null,
          tune_id: null,
          updated_at: now(),
        })
        // A hand-off on a captured file is one the worker never reads and the page never sends.
        await db.recording_files.update(id, { local_state: 'captured', error: null, handoff: null })
        continue
      }
      // A piece waiting for its cut plays from this audio; a later pass drops it.
      if (row && holdsSplitAudio(row, waiting)) continue
      await db.recording_files.delete(id)
      await deleteChunks(db, id)
      reports.ended(id)
    }

    // Read the owners off the primary keys rather than a unique-direction index cursor,
    // which Safari's IndexedDB refuses to open ("Unable to open cursor").
    const chunkKeys = await db.recording_chunks.toCollection().primaryKeys()
    const chunkOwners = [...new Set(chunkKeys.map(([recordingId]) => recordingId))]
    const owners = await db.recording_files.bulkGet(chunkOwners)
    for (const [i, recordingId] of chunkOwners.entries()) {
      const owner = owners[i]
      if (owner?.local_state === 'capturing' || owner?.chunked) continue
      await deleteChunks(db, recordingId)
    }
  })
}

/** The hand-off urls each page's background uploads already registered the sync for. Each
 * registration runs the worker at once, past the browser's retry backoff, so registering on
 * every pass would spend a hand-off's attempts in seconds during a short outage. A new page load
 * starts empty, so a hand-off whose tab closed before it registered still gets one. */
const requestedHandoffs = new WeakMap<BackgroundUploads, Set<string>>()

/**
 * Upload every captured blob whose row has reached the server. Blocked and stalled ones
 * are retried too. A row's own transient failure does not stop the rest of the pass; the
 * first one is returned (null when every row settled) so the caller can still fail the sync.
 * With `background` available, a file the service worker may send is reserved and left to it.
 */
export async function uploadPass(
  db: CrosstuneDb,
  api: SyncApi,
  reports: UploadReports,
  isStopped: () => boolean = () => false,
  background?: BackgroundUploads,
): Promise<unknown> {
  // Run before the quota skip below, so a blocked row whose recording was deleted
  // elsewhere is cleaned up instead of being skipped forever by the storage usage check.
  await dropTombstonedFiles(db, reports)
  const queue = await readUploadQueue(db, ['captured', 'blocked_quota', 'uploading'])
  if (!queue) return null
  const { files: waiting, rows, storage } = queue
  const nowMs = Date.now()
  // Set once the browser refuses a sync request in this pass. The browser's own availability
  // turns false too, but cannot tell a refusal from a browser that never had a worker.
  let refused = false
  const handedOff: [string, UploadHandoff][] = []
  /** Leaves a hand-off to the worker and registers the sync once for it, so the worker can run
   * it as soon as it is written. Once the browser refuses, no worker run will come, so the page
   * takes back every hand-off this pass met and sends the rest of the queue itself. */
  const leaveToWorker = async (id: string, handoff: UploadHandoff): Promise<void> => {
    if (!background || !(refused || background.available())) return
    handedOff.push([id, handoff])
    let requested = requestedHandoffs.get(background)
    if (!requested) requestedHandoffs.set(background, (requested = new Set()))
    if (!refused && (requested.has(handoff.url) || (await background.request()))) {
      requested.add(handoff.url)
      return
    }
    refused = true
    try {
      for (const [heldId, held] of handedOff.splice(0)) {
        await takeBackHandoff(db, heldId, held, { local_state: 'captured' })
      }
    } catch (error) {
      // Thrown from here it would replace the pass's own failure, such as an auth failure.
      Sentry.captureException(error)
    }
  }
  let firstError: unknown = null
  for (const [i, file] of waiting.entries()) {
    if (isStopped()) return null
    // A pass is the only place a blocked row is reconsidered, so re-check storage usage
    // rather than hammering the server with a slot request that will fail again.
    if (
      file.local_state === 'blocked_quota' &&
      storage &&
      storage.used_bytes + file.bytes > storage.quota_bytes
    ) {
      continue
    }
    // Takes no new slot and no backoff while the worker may still finish it.
    let takenBack = false
    if (isLiveHandoff(file, nowMs)) {
      await leaveToWorker(file.id, file.handoff)
      continue
    }
    if (file.handoff) {
      if (!(await takeBackHandoff(db, file.id, file.handoff))) continue
      // The page sends a file the server refused or the worker kept failing for this attempt.
      takenBack = !!file.handoff.refused || file.handoff.attempts >= HANDOFF_TAKE_BACK_ATTEMPTS
    }
    if (file.next_attempt_at !== null && file.next_attempt_at > nowMs) continue
    if (!pageWouldUpload(rows[i], file, storage, nowMs)) continue
    try {
      const worker = !takenBack && !refused && background?.available() ? background : undefined
      const handoff = await uploadOne(db, api, reports, file.id, worker)
      if (handoff) await leaveToWorker(file.id, handoff)
    } catch (error) {
      // The server's plan refuses every recording alike, so the rest wait for the next pass
      // without failing this one.
      if (isPlanRefusal(error)) break
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

/** A downloaded blob whose revision no longer matches the row's current playback file, as
 * after a trim. A blob never downloaded from the server (the raw capture or upload, kept
 * as is) has no revision of its own and is never stale. */
export function isStale(row: LocalRecording, file: RecordingFile): boolean {
  return file.blob_rev !== null && file.blob_rev !== row.playback_rev
}

/** Store a fetch's result only while its recording is still live. A fetch can land after the
 * recording was deleted, and storing then would bring back the file row the delete removed. */
async function whileLive(
  db: CrosstuneDb,
  id: string,
  store: () => Promise<void>,
): Promise<boolean> {
  return db.transaction('rw', db.recordings, db.recording_files, db.recording_chunks, async () => {
    const row = await db.recordings.get(id)
    if (!row || row.deleted_at) return false
    await store()
    return true
  })
}

export async function downloadOne(db: CrosstuneDb, api: SyncApi, id: string): Promise<Blob | null> {
  const file = await db.recording_files.get(id)
  const row = await db.recordings.get(id)
  if (hasLocalAudio(file) && !(row && isStale(row, file))) return readLocalAudio(db, file)
  if (!row || row.deleted_at || row.state !== 'ready') return null
  const previousState = file ? restingState(file.local_state) : null
  await setFileState(db, id, 'downloading')
  try {
    // The row's own playback_rev/start can already be behind this response by the time it
    // lands: a pull runs on its own loop and a trim can commit mid-download. What the server
    // signed, not what this device has pulled, is what the downloaded bytes are tagged with.
    const signed = await api.downloadUrl(id)
    const blob = await api.getObject(signed.url)
    const stored = await whileLive(db, id, () =>
      storeDownloadedBlob(
        db,
        id,
        blob,
        row.playback_mime ?? blob.type,
        signed.playback_rev,
        signed.playback_start_ms,
      ),
    )
    if (!stored) return null
    // A waveform that fails to fetch never undoes an audio download that already succeeded.
    await fetchPeaks(db, api, id).catch(() => null)
    return blob
  } catch (error) {
    // A row that had no state before downloading gets none back; setFileState no-ops on it.
    if (previousState) await setFileState(db, id, previousState)
    throw error
  }
}

/** A failure a second try might not meet: a dropped connection or a server error. */
function isTransient(error: unknown): boolean {
  return (
    error instanceof NetworkError ||
    ((error instanceof ApiError || error instanceof TransferError) && error.status >= 500)
  )
}

/**
 * Read a recording's audio or a scan's image through a signed URL, storing nothing. A transient
 * failure gets one more try; anything else, or an abort of `signal`, rejects at once.
 */
export async function fetchUnstored(
  api: SyncApi,
  kind: 'recording' | 'scan',
  id: string,
  signal?: AbortSignal,
  readBody?: ReadBody,
): Promise<Blob> {
  const once = async () => {
    const signed =
      kind === 'recording'
        ? await api.downloadUrl(id, signal)
        : await api.scanDownloadUrl(id, signal)
    return api.getObject(signed.url, signal, readBody)
  }
  try {
    return await once()
  } catch (error) {
    signal?.throwIfAborted()
    if (!isTransient(error)) throw error
    return once()
  }
}

/**
 * Fetch the waveform for a recording's current revision, once. A row whose peaks have not
 * been built yet keeps whatever it already has (capture-time peaks, or none) until they have.
 */
export async function fetchPeaks(
  db: CrosstuneDb,
  api: SyncApi,
  id: string,
): Promise<Uint8Array | null> {
  const row = await db.recordings.get(id)
  const file = await db.recording_files.get(id)
  if (!row || row.deleted_at || row.state !== 'ready' || row.peaks_rev === null) {
    return file?.peaks ?? null
  }
  if (file?.peaks && file.peaks_rev === row.peaks_rev) return file.peaks
  // As with the download, tag the bytes with what the server actually signed, not
  // with this row's own peaks_rev, which can already be behind it.
  const signed = await api.peaksUrl(id)
  const blob = await api.getObject(signed.url)
  const peaks = new Uint8Array(await blob.arrayBuffer())
  const stored = await whileLive(db, id, () => storePeaks(db, id, peaks, signed.peaks_rev))
  return stored ? peaks : null
}

export interface DownloadRetries {
  isWaiting(id: string): boolean
  failed(id: string): void
  succeeded(id: string): void
}

/** When the download pass may next try each recording whose download failed, backing off as
 * uploads do so a persistent error is not re-sent after every sync. Kept in memory: a reload
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

/** When the device keeps recordings offline, fetch audio and waveforms for every ready
 * recording that lacks a current one, including a blob left over from a trimmed revision.
 * `fetch` and `fetchPeaksFor` let the caller share one in-flight attempt per recording with
 * any other path that fetches. */
export async function downloadPass(
  db: CrosstuneDb,
  api: SyncApi,
  {
    fetch = (id) => downloadOne(db, api, id),
    retries = createDownloadRetries(),
    fetchPeaksFor = (id) => fetchPeaks(db, api, id),
    isStopped = () => false,
    headroom = storageHeadroom,
  }: {
    fetch?: (id: string) => Promise<Blob | null>
    retries?: DownloadRetries
    fetchPeaksFor?: (id: string) => Promise<Uint8Array | null>
    isStopped?: () => boolean
    headroom?: () => Promise<number | null>
  } = {},
): Promise<void> {
  if (!(await getKeepOffline(db))) {
    await setDownloadsHeldForSpace(db, false)
    return
  }
  const rows = await db.recordings.filter((r) => !r.deleted_at && r.state === 'ready').toArray()
  const files = await db.recording_files.bulkGet(rows.map((r) => r.id))
  const room = await roomAboveReserve(headroom)
  let heldForSpace = false
  for (const [i, row] of rows.entries()) {
    if (isStopped()) return
    let file = files[i]
    const wanted = (!hasLocalAudio(file) || isStale(row, file)) && !retries.isWaiting(row.id)
    // A download can be fetched again later; a recording cannot be made again.
    if (wanted && !room.take(row.playback_bytes ?? 0)) heldForSpace = true
    else if (wanted) {
      try {
        await fetch(row.id)
        // The fetch may have stored the peaks that came with a fresh blob.
        file = await db.recording_files.get(row.id)
        retries.succeeded(row.id)
      } catch (error) {
        // Offline and auth failures stop the whole pass; anything else is this row's
        // problem alone, so record it and let the rest of the kept-offline set still download.
        if (error instanceof NetworkError || isAuthFailure(error)) {
          throw error
        }
        retries.failed(row.id)
        if (file) {
          await setFileState(db, row.id, restingState(file.local_state), errorText(error))
        }
      }
    }

    const peaksWaitKey = `peaks:${row.id}`
    if (
      row.peaks_rev !== null &&
      file?.peaks_rev !== row.peaks_rev &&
      !retries.isWaiting(peaksWaitKey)
    ) {
      try {
        await fetchPeaksFor(row.id)
        retries.succeeded(peaksWaitKey)
      } catch {
        // A missing waveform never fails the pass; it just waits for the next one, backed off.
        retries.failed(peaksWaitKey)
      }
    }
  }
  await setDownloadsHeldForSpace(db, heldForSpace)
}

/** Room kept free for new recordings: an hour of stereo at the highest quality. */
export const CAPTURE_RESERVE_BYTES = (2 * AUDIO_BITRATES.highest * 3600) / 8

/** The room above the capture reserve, read once and spent as a pass stores files. Unlimited
 * when the browser does not report its storage, so nothing is held back on a guess. */
export async function roomAboveReserve(headroom: () => Promise<number | null>) {
  const free = await headroom()
  let left = free === null ? Infinity : free - CAPTURE_RESERVE_BYTES
  return {
    fits: (bytes: number) => bytes <= left,
    /** How many more bytes `bytes` needs than the room left holds. */
    shortBy: (bytes: number) => bytes - Math.max(0, left),
    take(bytes: number): boolean {
      if (bytes > left) return false
      left -= bytes
      return true
    },
  }
}

/**
 * Joins each finished capture's chunks into one stored blob while the copy that needs still
 * leaves the capture reserve free. A file that does not fit stays chunked, which loses nothing.
 */
export async function joinChunkedCaptures(
  db: CrosstuneDb,
  { headroom = storageHeadroom }: { headroom?: () => Promise<number | null> } = {},
): Promise<void> {
  // Chunk keys first: a pass with nothing chunked reads no file rows.
  const chunkKeys = await db.recording_chunks.toCollection().primaryKeys()
  const owners = [...new Set(chunkKeys.map(([recordingId]) => recordingId))]
  if (owners.length === 0) return
  // A file the service worker is sending keeps its chunks, which the worker reads.
  const nowMs = Date.now()
  const files = (await db.recording_files.bulkGet(owners)).filter(
    (file): file is RecordingFile => holdsChunkedAudio(file) && !isLiveHandoff(file, nowMs),
  )
  const room = await roomAboveReserve(headroom)
  // A join frees its chunks as it commits, so it needs the room only while it writes.
  for (const file of files) if (room.fits(file.bytes)) await joinCapturedChunks(db, file.id)
}

/** Stores the account's storage usage and its country's center from the API. */
export async function refreshAccount(db: CrosstuneDb, api: SyncApi): Promise<void> {
  const me = await api.me()
  await setStorage(db, me.storage)
  await setCountryCenter(db, me.country_center)
}
