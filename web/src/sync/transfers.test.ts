import { beforeEach, describe, expect, it, vi } from 'vitest'
import { noopAnalytics } from '../usage/client'
import { recordingAnalytics } from '../usage/testing'
import { ApiError, NetworkError, NoTokenError } from '../api/client'
import {
  addRecordingFromLink,
  appendChunk,
  beginCapture,
  deleteRecording,
  finishCapture,
  joinCapturedChunks,
  storeDownloadedBlob,
  storePeaks,
} from '../commands/recordings'
import { addLink } from '../commands/links'
import { splitRecording } from '../commands/split'
import { createTune, deleteTune } from '../commands/tunes'
import {
  CHUNK_MS,
  HANDOFF_TAKE_BACK_ATTEMPTS,
  hasLocalAudio,
  readLocalAudio,
  type RecordingFile,
  type UploadHandoff,
} from '../db/recordings'
import { MAX_RECORDING_MS, MAX_SPLIT_SOURCE_MS } from '../domain/recordingLimits'
import { BACKGROUND_UPLOAD_MAX_BYTES } from '../platform/backgroundSync'
import {
  getCountryCenter,
  getDownloadsHeldForSpace,
  getStorage,
  setKeepOffline,
  setStorage,
} from '../db/meta'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { newId } from '../commands/write'
import { openTestDb } from '../test/db'
import { transfersSettled } from '../test/transfers'
import { createFakeApi, serverRecording, serverTune } from '../test/fakeApi'
import { entitlementRow, recordingFile, recordingRow } from '../test/rows'
import { applyPullPage } from './apply'
import { FakeLockManager } from '../test/fakeLocks'
import { acquireCaptureLock } from './captureLock'
import { createSyncEngine } from './engine'
import { runUploadHandoffs } from '../sw/uploadHandoffs'
import { PREMIUM_REQUIRED_PROBLEM } from './errors'
import type { SyncEngine } from './types'
import {
  CAPTURE_LOCK_GRACE_MS,
  CAPTURE_RESERVE_BYTES,
  joinChunkedCaptures,
  createDownloadRetries,
  createUploadReports,
  downloadOne,
  downloadPass,
  fetchPeaks,
  isStale,
  pageWouldUpload,
  QUOTA_PROBLEM,
  recoverInterruptedCaptures,
  retryDelayMs,
  STALE_CAPTURE_MS,
  uploadPass,
} from './transfers'
import { DEFAULT_ISOLATE, isolateToPatch } from '../features/player/isolate/isolateSetting'

let db: CrosstuneDb
let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  db = openTestDb()
  fake = createFakeApi()
})

const AT = '2026-09-14T20:00:00.000Z'

async function captured(): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
  await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
  await finishCapture(db, id, {
    tuneId: null,
    mime: 'audio/mp4',
    durationMs: 3000,
    recordedAt: AT,
    peaks: null,
  })
  return id
}

async function syncAndTransfer(engine: SyncEngine): Promise<void> {
  await engine.sync()
  await transfersSettled(engine)
}

async function pushed(id: string): Promise<void> {
  const engine = createSyncEngine({
    analytics: noopAnalytics,
    db,
    api: fake.api,
    isOnline: () => true,
  })
  await syncAndTransfer(engine)
  engine.stop()
  expect(await pendingFor(db, 'recordings', id)).toBeUndefined()
  // The transfer pass this triggers may itself have failed and scheduled a backoff;
  // callers that use pushed() only to stage the row on the server don't want that
  // incidental attempt counted against the one they are about to make themselves.
  await db.recording_files.update(id, { upload_attempts: 0, next_attempt_at: null })
}

/** A file row left behind by Remove downloaded audio: known locally, blob gone. */
async function clearedDownload(id: string): Promise<void> {
  await storeDownloadedBlob(db, id, new Blob(['old']), 'audio/mp4', 'seed-rev', 0)
  await db.recording_files.update(id, { blob: null, bytes: 0 })
}

// What a real pull would have already delivered for a ready recording's own row, and
// what the fake signs a download for by default: a test after a specific race (a pull
// behind what the server just signed) overrides one or the other explicitly.
const READY_REV = 'ready0001'

async function readyOnServer(id: string, tuneId: string | null = null): Promise<void> {
  await db.recordings.put({
    id,
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 5,
    tune_id: tuneId,
    label: null,
    source: 'microphone',
    origin: 'own',
    origin_url: null,
    added_at: AT,
    recorded_at: AT,
    recorded_precision: 'time',
    position: 0,
    state: 'ready',
    duration_ms: 3000,
    playback_mime: 'audio/mp4',
    playback_bytes: 3,
    error: null,
    trim_start_ms: 0,
    trim_end_ms: null,
    speed_percent: 100,
    pitch_cents: 0,
    source_duration_ms: null,
    playback_start_ms: 0,
    playback_end_ms: null,
    playback_rev: READY_REV,
    peaks_rev: null,
    is_mono: null,
    ...isolateToPatch(DEFAULT_ISOLATE),
    split_completed_id: null,
  })
  fake.recordingStates.set(id, 'ready')
  fake.objects.set(`${id}/playback.m4a`, new Blob(['xyz'], { type: 'audio/mp4' }))
  fake.signDownload(id, READY_REV, 0)
}

describe('uploadPass', () => {
  it('waits until the row has been pushed', async () => {
    const id = await captured()
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    expect(fake.objects.size).toBe(0)
  })

  it('holds the upload of a recording over 3 hours until it is split', async () => {
    const id = await captured()
    await pushed(id)
    await db.recording_files.update(id, { local_state: 'captured', local_duration_ms: 10_800_001 })
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(slot).not.toHaveBeenCalled()
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
  })

  it('holds the upload of an unsplit recording over the per-file limit', async () => {
    fake.setStorage({ used_bytes: 0, quota_bytes: 1_000_000, max_file_bytes: 2 })
    const id = await captured()
    await pushed(id)
    const file = await db.recording_files.get(id)
    expect(file!.bytes).toBeGreaterThan(2)
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(slot).not.toHaveBeenCalled()
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
  })

  it('uploads it once split_id is set and pushed', async () => {
    const id = await captured()
    await db.recording_files.update(id, { local_duration_ms: 10_800_001 })
    const splitId = newId()
    await db.recordings.update(id, { split_id: splitId, split_size: 2 })
    await db.outbox
      .filter((entry) => entry.row_id === id)
      .modify((entry) => {
        if (entry.data) Object.assign(entry.data, { split_id: splitId, split_size: 2 })
      })
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(slot).not.toHaveBeenCalled()
    await pushed(id)
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(slot).toHaveBeenCalledTimes(1)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('requests no slot for an import row, which has no file', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
    const linkId = await addLink(db, tuneId, {
      url: 'https://www.slippery-hill.com/recording/7',
      provider: 'slippery_hill',
      provider_ref: '7',
      title: 'Slow version',
    })
    const id = await addRecordingFromLink(db, linkId)
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    await pushed(id)
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(slot).not.toHaveBeenCalled()
    expect(fake.objects.size).toBe(0)
    expect(await db.recording_files.get(id)).toBeUndefined()
  })

  it('requests a slot, puts the blob, and confirms', async () => {
    const id = await captured()
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
    expect(await fake.objects.get(`${id}/upload`)?.text()).toBe('abc')
    expect(fake.recordingStates.get(id)).toBe('uploaded')
  })

  it('marks a quota refusal from the slot request as blocked and keeps the blob', async () => {
    const id = await captured()
    fake.failSlot(
      new ApiError(413, { type: QUOTA_PROBLEM, title: 't', status: 413, detail: 'full' }),
    )
    await pushed(id)
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'blocked_quota',
      bytes: 3,
    })
    fake.failSlot(null)
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('marks a file-too-large refusal from the slot request as permanently failed', async () => {
    const id = await captured()
    fake.failSlot(
      new ApiError(413, {
        type: 'urn:crosstune:file-too-large',
        title: 't',
        status: 413,
        detail: 'too big',
      }),
    )
    await pushed(id)
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'failed_upload',
      error: 'too big',
    })
  })

  it('queues the row again and keeps the recording waiting when the slot request finds no row', async () => {
    const id = await captured()
    fake.failSlot(
      new ApiError(404, { type: 'about:blank', title: 't', status: 404, detail: 'gone' }),
    )
    // As if the row had been pushed and then lost on the server.
    await db.outbox.clear()
    const before = (await db.recordings.get(id))!.updated_at
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(await db.recording_files.get(id)).toMatchObject({ local_state: 'captured', error: null })
    const queued = await pendingFor(db, 'recordings', id)
    expect(queued?.op).toBe('upsert')
    expect(queued!.updated_at >= before).toBe(true)

    fake.failSlot(null)
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('marks a slot conflict as already uploaded', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(409, null))
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('resets to captured and holds a 500 from the slot request as the pass error', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(500, null))
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    await expect(
      uploadPass(db, fake.api, createUploadReports(noopAnalytics)),
    ).resolves.toBeInstanceOf(ApiError)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
  })

  it('resets to captured and holds the error when storage is not configured on the server', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(503, null))
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    await expect(
      uploadPass(db, fake.api, createUploadReports(noopAnalytics)),
    ).resolves.toBeInstanceOf(ApiError)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
  })

  it('holds a network failure from the slot request as the pass error instead of aborting', async () => {
    const id = await captured()
    fake.failSlot(new NetworkError(new TypeError('x')))
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    await expect(
      uploadPass(db, fake.api, createUploadReports(noopAnalytics)),
    ).resolves.toBeInstanceOf(NetworkError)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
  })

  it('keeps the reason on a row it backs off, so the row can say why it waits', async () => {
    const id = await captured()
    fake.failSlot(
      new ApiError(503, {
        type: 'about:blank',
        title: 'x',
        status: 503,
        detail: 'Storage is down',
      }),
    )
    await pushed(id)
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'captured',
      error: 'Storage is down',
      upload_attempts: 1,
    })
  })

  it('reports a network failure while online as a transfer error, and offline when offline', async () => {
    const id = await captured()
    fake.failSlot(new NetworkError(new TypeError('Failed to fetch')))
    await pushed(id)
    let online = true
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => online,
    })
    await engine.transfer()
    expect(engine.transferStatus()).toBe('error')
    engine.stop()

    online = false
    await db.recording_files.update(id, { next_attempt_at: null })
    const offline = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => online,
    })
    await offline.transfer()
    expect(offline.transferStatus()).toBe('offline')
    offline.stop()
  })

  it('skips a row on backoff instead of requesting a slot again right away', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(500, null))
    await pushed(id)
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    const first = await db.recording_files.get(id)
    expect(first?.upload_attempts).toBe(1)
    expect(first?.next_attempt_at).not.toBeNull()

    const slotSpy = vi.spyOn(fake.api, 'requestUploadSlot')
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(slotSpy).not.toHaveBeenCalled()
    expect((await db.recording_files.get(id))?.upload_attempts).toBe(1)
  })

  it('doubles the backoff delay on each consecutive transient failure', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(500, null))
    await pushed(id)

    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    const first = await db.recording_files.get(id)
    const firstDelay = (first?.next_attempt_at ?? 0) - Date.now()
    expect(firstDelay).toBeGreaterThan(25_000)
    expect(firstDelay).toBeLessThanOrEqual(30_000)

    // Past its own backoff window, the row is retried again on the next pass.
    await db.recording_files.update(id, { next_attempt_at: Date.now() - 1 })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    const second = await db.recording_files.get(id)
    expect(second?.upload_attempts).toBe(2)
    const secondDelay = (second?.next_attempt_at ?? 0) - Date.now()
    expect(secondDelay).toBeGreaterThan(55_000)
    expect(secondDelay).toBeLessThanOrEqual(60_000)
  })

  it('clears the backoff fields once a retried upload succeeds', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(500, null))
    await pushed(id)
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect((await db.recording_files.get(id))?.upload_attempts).toBe(1)

    fake.failSlot(null)
    await db.recording_files.update(id, { next_attempt_at: Date.now() - 1 })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    const settled = await db.recording_files.get(id)
    expect(settled?.local_state).toBe('uploaded')
    expect(settled?.upload_attempts).toBe(0)
    expect(settled?.next_attempt_at).toBeNull()
  })

  it('sends a fresh slot next pass when confirmation reports a conflict', async () => {
    const id = await captured()
    fake.failConfirm(new ApiError(409, null))
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('marks a confirmation rejection permanent when the object no longer matches', async () => {
    const id = await captured()
    fake.failConfirm(
      new ApiError(413, { type: 'about:blank', title: 't', status: 413, detail: 'size mismatch' }),
    )
    await pushed(id)
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'failed_upload',
      error: 'size mismatch',
    })
  })

  it('retries a row left uploading after the tab closed mid-transfer', async () => {
    const id = await captured()
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
    await db.recording_files.update(id, { local_state: 'uploading' })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('restores a captured recording as unfiled when a pulled tombstone deletes its tune elsewhere', async () => {
    const { tuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    const id = newId()
    await beginCapture(db, id, { tuneId, recordedAt: AT })
    await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
    await finishCapture(db, id, {
      tuneId,
      mime: 'audio/mp4',
      durationMs: 3000,
      recordedAt: AT,
      peaks: null,
    })
    // As if the recording's row reached the server before the tune was deleted on another device.
    await db.outbox.clear()
    const deletedAt = '2026-09-14T21:00:00.000Z'
    await applyPullPage(
      db,
      [
        {
          table: 'tunes',
          row: serverTune({ id: tuneId, deleted_at: deletedAt, updated_at: deletedAt }),
        },
        {
          table: 'recordings',
          row: serverRecording({
            id,
            tune_id: tuneId,
            deleted_at: deletedAt,
            updated_at: deletedAt,
          }),
        },
      ],
      10,
    )
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    const file = await db.recording_files.get(id)
    expect(file?.local_state).toBe('captured')
    expect(await (await readLocalAudio(db, file))?.text()).toBe('abc')
    expect(await db.recordings.get(id)).toMatchObject({ deleted_at: null, tune_id: null })
    const queued = await pendingFor(db, 'recordings', id)
    expect(queued).toMatchObject({ op: 'upsert' })
    expect(queued?.data).toMatchObject({ tune_id: null })
  })

  it('drops the file of an uploaded recording once its recording is tombstoned elsewhere', async () => {
    const id = await captured()
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
    await db.recordings.update(id, { deleted_at: AT })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(await db.recording_files.get(id)).toBeUndefined()
    expect(await pendingFor(db, 'recordings', id)).toBeUndefined()
  })

  it('keeps the file of an uploaded split parent tombstoned elsewhere while a piece waits', async () => {
    const id = await captured()
    await pushed(id)
    const [pieceId] = await splitRecording(db, id, [1_500])
    await db.recordings.update(id, { deleted_at: AT })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect((await db.recording_files.get(id))?.blob).toBeTruthy()

    await db.recordings.update(pieceId!, { state: 'ready' })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(await db.recording_files.get(id)).toBeUndefined()
  })

  it('skips a blocked row until storage usage shows room for it', async () => {
    const id = await captured()
    fake.failSlot(
      new ApiError(413, { type: QUOTA_PROBLEM, title: 't', status: 413, detail: 'full' }),
    )
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    fake.failSlot(null)

    await setStorage(db, { used_bytes: 98, quota_bytes: 100, max_file_bytes: 50 })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    expect(fake.objects.has(`${id}/upload`)).toBe(false)

    await setStorage(db, { used_bytes: 50, quota_bytes: 100, max_file_bytes: 50 })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('restores a blocked row whose recording is tombstoned instead of skipping it forever', async () => {
    const id = await captured()
    fake.failSlot(
      new ApiError(413, { type: QUOTA_PROBLEM, title: 't', status: 413, detail: 'full' }),
    )
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    // Usage that would otherwise skip the row without ever reaching the tombstone check.
    await setStorage(db, { used_bytes: 99, quota_bytes: 100, max_file_bytes: 50 })
    await db.recordings.update(id, { deleted_at: AT })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    expect((await db.recordings.get(id))?.deleted_at).toBeNull()
  })

  it('restores a failed_upload row once its recording is tombstoned, even though it is not retried', async () => {
    const id = await captured()
    fake.failSlot(
      new ApiError(422, { type: 'about:blank', title: 't', status: 422, detail: 'bad' }),
    )
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('failed_upload')
    fake.failSlot(null)
    await db.recordings.update(id, { deleted_at: AT })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(await db.recording_files.get(id)).toMatchObject({ local_state: 'captured', error: null })
    expect((await pendingFor(db, 'recordings', id))?.op).toBe('upsert')
  })

  it('drops the hand-off of a handed-off row whose recording is tombstoned', async () => {
    const id = await captured()
    await db.recording_files.update(id, {
      local_state: 'uploading',
      handoff: {
        url: 'https://r2.example/put',
        confirm_token: 'token',
        content_type: 'audio/mp4',
        expires_at: Date.now() + 60_000,
        attempts: 0,
      },
    })
    await db.recordings.update(id, { deleted_at: AT })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'captured',
      handoff: null,
    })
  })

  it('drops a file whose recording row was never stored here', async () => {
    const id = await captured()
    await db.recordings.delete(id)
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(await db.recording_files.get(id)).toBeUndefined()
    expect(await db.recording_chunks.where('recording_id').equals(id).count()).toBe(0)
  })

  it('marks a 422 from the slot request permanently failed without blocking the rest of the pass', async () => {
    const bad = await captured()
    const good = await captured()
    fake.failSlot(
      new ApiError(422, {
        type: 'about:blank',
        title: 't',
        status: 422,
        detail: 'unsupported mime',
      }),
      bad,
    )
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await syncAndTransfer(engine)
    engine.stop()
    expect(await db.recording_files.get(bad)).toMatchObject({
      local_state: 'failed_upload',
      error: 'unsupported mime',
    })
    expect((await db.recording_files.get(good))?.local_state).toBe('uploaded')
  })

  it('holds the first transient error and still tries the rest of the queue', async () => {
    const bad = await captured()
    const good = await captured()
    fake.failSlot(new ApiError(500, null))
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await syncAndTransfer(engine)
    expect((await db.recording_files.get(bad))?.local_state).toBe('captured')
    expect((await db.recording_files.get(good))?.local_state).toBe('captured')
    engine.stop()
    // Backoff from the pass above must not suppress the pass this test is about.
    await db.recording_files.update(bad, { upload_attempts: 0, next_attempt_at: null })
    await db.recording_files.update(good, { upload_attempts: 0, next_attempt_at: null })

    fake.failSlot(new ApiError(500, null), bad)
    const held = await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(held).toBeInstanceOf(ApiError)
    expect((await db.recording_files.get(bad))?.local_state).toBe('captured')
    expect((await db.recording_files.get(good))?.local_state).toBe('uploaded')
  })

  it('returns null when every row in the pass settles', async () => {
    const id = await captured()
    expect(await uploadPass(db, fake.api, createUploadReports(noopAnalytics))).toBeNull()
    await pushed(id)
    expect(await uploadPass(db, fake.api, createUploadReports(noopAnalytics))).toBeNull()
  })

  it('deletes chunks that have no file row or whose file holds no chunked audio', async () => {
    // A genuinely orphaned chunk: no file row was ever created for it.
    await db.recording_chunks.put({ recording_id: 'ghost', idx: 0, blob: new Blob(['x']) })
    // A chunk left behind after its capture was joined into one blob.
    const joined = await captured()
    await joinCapturedChunks(db, joined)
    await db.recording_chunks.put({ recording_id: joined, idx: 99, blob: new Blob(['y']) })
    // A finished capture whose chunks are its audio.
    const chunked = await captured()
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(await db.recording_chunks.where('recording_id').equals('ghost').count()).toBe(0)
    expect(await db.recording_chunks.where('recording_id').equals(joined).count()).toBe(0)
    expect(await db.recording_chunks.where('recording_id').equals(chunked).count()).toBe(1)
  })
})

describe('uploadPass with background uploads', () => {
  const SLOT_EXPIRES = '2999-01-01T00:00:00Z'

  function fakeBackground(available = true, registers = true) {
    return { available: () => available, request: vi.fn(async () => registers) }
  }

  /** Runs `between` once, at the pass's first slot request: after it read the queue. */
  function onFirstSlot(between: (recordingId: string) => Promise<unknown>) {
    const request = fake.api.requestUploadSlot.bind(fake.api)
    let ran = false
    return vi.spyOn(fake.api, 'requestUploadSlot').mockImplementation(async (...args) => {
      if (!ran) {
        ran = true
        await between(args[0])
      }
      return request(...args)
    })
  }

  /** A captured recording whose row the server already holds, so its upload can start. */
  async function onServer(): Promise<string> {
    const id = await captured()
    await db.outbox.clear()
    return id
  }

  function handoff(overrides: Partial<UploadHandoff> = {}): UploadHandoff {
    return {
      url: 'https://fake.r2/old/upload',
      confirm_token: 'old-token',
      content_type: 'audio/mp4',
      expires_at: Date.now() + 60_000,
      attempts: 0,
      ...overrides,
    }
  }

  it('hands a small file to the worker instead of putting it', async () => {
    const id = await onServer()
    await db.recording_files.update(id, { error: 'earlier failure', upload_attempts: 2 })
    const analytics = recordingAnalytics()
    const reports = createUploadReports(analytics, () => true)
    const row = (await db.recordings.get(id))!
    const pageFailure = new NetworkError(new TypeError('Failed to fetch'))
    reports.failed(row, pageFailure)
    const put = vi.spyOn(fake.api, 'putObject')
    const background = fakeBackground()
    await uploadPass(db, fake.api, reports, undefined, background)
    expect(put).not.toHaveBeenCalled()
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'uploading',
      handoff: {
        url: `https://fake.r2/${id}/upload?ct=audio/mp4`,
        confirm_token: `token-${id}`,
        content_type: 'audio/mp4',
        expires_at: Date.parse(SLOT_EXPIRES),
        attempts: 0,
      },
      error: null,
      upload_attempts: 0,
      next_attempt_at: null,
    })
    expect(background.request).toHaveBeenCalledTimes(1)
    // A later page failure starts a new run of failures, so it is reported.
    reports.failed(row, pageFailure)
    expect(analytics.sends()).toHaveLength(2)
  })

  it('registers the sync for a hand-off before the page puts a large file', async () => {
    const [small, large] = [await onServer(), await onServer()].sort()
    await db.recording_files.update(large!, { bytes: BACKGROUND_UPLOAD_MAX_BYTES + 1 })
    const background = fakeBackground()
    let registeredBeforePut = false
    const putObject = fake.api.putObject.bind(fake.api)
    vi.spyOn(fake.api, 'putObject').mockImplementation(async (...args) => {
      registeredBeforePut = background.request.mock.calls.length > 0
      return putObject(...args)
    })
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics), undefined, background)
    expect((await db.recording_files.get(small!))?.handoff).not.toBeNull()
    expect(registeredBeforePut).toBe(true)
  })

  it('takes back a hand-off whose confirm the server refused and backs off on its own refusal', async () => {
    const id = await onServer()
    await db.recording_files.update(id, { local_state: 'uploading', handoff: handoff() })
    await runUploadHandoffs({
      fetch: async (_input, init) =>
        new Response(null, { status: init?.method === 'PUT' ? 200 : 409 }),
      now: () => Date.now(),
      databaseNames: async () => [db.name],
    })
    expect((await db.recording_files.get(id))?.handoff?.refused).toBe(true)

    fake.failConfirm(new ApiError(409, null))
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    const put = vi.spyOn(fake.api, 'putObject')
    const background = fakeBackground()
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics), undefined, background)
    expect(slot).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
    const file = await db.recording_files.get(id)
    expect(file).toMatchObject({ local_state: 'captured', handoff: null })
    expect(file?.next_attempt_at).toBeGreaterThan(Date.now())
    expect(background.request).not.toHaveBeenCalled()
  })

  it('returns handed-off files to the queue when the browser refuses the sync', async () => {
    const id = await onServer()
    const earlier = await onServer()
    await db.recording_files.update(earlier, { local_state: 'uploading', handoff: handoff() })
    const background = fakeBackground(true, false)
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics), undefined, background)
    expect(background.request).toHaveBeenCalledTimes(1)
    for (const file of [id, earlier]) {
      expect(await db.recording_files.get(file)).toMatchObject({
        local_state: 'captured',
        handoff: null,
        next_attempt_at: null,
      })
    }
  })

  it('leaves a file another pass handed off after this pass read the queue', async () => {
    const first = await onServer()
    const second = await onServer()
    // Whichever file the pass reaches first, another tab hands off the other one.
    const slot = onFirstSlot((id) =>
      db.recording_files.update(id === first ? second : first, {
        local_state: 'uploading',
        handoff: handoff(),
      }),
    )
    const put = vi.spyOn(fake.api, 'putObject')
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics))
    expect(slot).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('leaves an expired hand-off the worker settled after this pass read the queue', async () => {
    // The pass reads captured files before uploading ones, so this one's slot comes first.
    await onServer()
    const settled = await onServer()
    await db.recording_files.update(settled, {
      local_state: 'uploading',
      handoff: handoff({ expires_at: Date.now() - 1 }),
    })
    const slot = onFirstSlot(() =>
      db.recording_files.update(settled, { local_state: 'uploaded', handoff: null }),
    )
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics), undefined, fakeBackground())
    expect(slot).toHaveBeenCalledTimes(1)
    expect(await db.recording_files.get(settled)).toMatchObject({
      local_state: 'uploaded',
      handoff: null,
    })
  })

  it.each([
    {
      name: 'a file over the background limit',
      stage: (id: string) =>
        db.recording_files.update(id, { bytes: BACKGROUND_UPLOAD_MAX_BYTES + 1 }),
    },
    {
      // Past even the split cap, so it is not held for a split and its upload goes ahead.
      name: 'a recording over the length limit',
      stage: (id: string) =>
        db.recording_files.update(id, { local_duration_ms: MAX_SPLIT_SOURCE_MS + 1 }),
    },
    {
      name: 'a split parent',
      stage: (id: string) => db.recordings.update(id, { split_id: newId(), split_size: 2 }),
    },
  ])('keeps the page upload for $name', async ({ stage }) => {
    const id = await onServer()
    await stage(id)
    const put = vi.spyOn(fake.api, 'putObject')
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics), undefined, fakeBackground())
    expect(put).toHaveBeenCalledTimes(1)
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'uploaded',
      handoff: null,
    })
  })

  it('keeps the page upload when background sync is not available', async () => {
    const id = await onServer()
    const put = vi.spyOn(fake.api, 'putObject')
    const background = fakeBackground(false)
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics), undefined, background)
    expect(put).toHaveBeenCalledTimes(1)
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'uploaded',
      handoff: null,
    })
    expect(background.request).not.toHaveBeenCalled()
  })

  it('leaves a live hand-off alone', async () => {
    const id = await onServer()
    const live = handoff({ attempts: HANDOFF_TAKE_BACK_ATTEMPTS - 1 })
    await db.recording_files.update(id, {
      local_state: 'uploading',
      handoff: live,
      upload_attempts: 2,
      next_attempt_at: null,
    })
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    const put = vi.spyOn(fake.api, 'putObject')
    const analytics = recordingAnalytics()
    const background = fakeBackground()
    await uploadPass(
      db,
      fake.api,
      createUploadReports(analytics, () => true),
      undefined,
      background,
    )
    expect(slot).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'uploading',
      handoff: live,
      upload_attempts: 2,
      next_attempt_at: null,
    })
    expect(analytics.sends()).toEqual([])
    expect(background.request).toHaveBeenCalledTimes(1)
  })

  it('registers the sync once per hand-off across passes', async () => {
    const id = await onServer()
    await db.recording_files.update(id, { local_state: 'uploading', handoff: handoff() })
    const background = fakeBackground()
    const pass = () =>
      uploadPass(db, fake.api, createUploadReports(noopAnalytics), undefined, background)
    await pass()
    await pass()
    expect(background.request).toHaveBeenCalledTimes(1)

    await db.recording_files.update(id, {
      handoff: handoff({ url: 'https://fake.r2/new/upload' }),
    })
    await pass()
    expect(background.request).toHaveBeenCalledTimes(2)
  })

  it('takes back a hand-off the worker failed too often', async () => {
    const id = await onServer()
    await db.recording_files.update(id, {
      local_state: 'uploading',
      handoff: handoff({ attempts: HANDOFF_TAKE_BACK_ATTEMPTS }),
    })
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    const put = vi.spyOn(fake.api, 'putObject')
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics), undefined, fakeBackground())
    expect(slot).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'uploaded',
      handoff: null,
    })
  })

  it('takes back an expired hand-off', async () => {
    const id = await onServer()
    await db.recording_files.update(id, {
      local_state: 'uploading',
      handoff: handoff({ expires_at: Date.now() - 1 }),
    })
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    const put = vi.spyOn(fake.api, 'putObject')
    await uploadPass(db, fake.api, createUploadReports(noopAnalytics), undefined, fakeBackground())
    expect(slot).toHaveBeenCalledTimes(1)
    expect(put).not.toHaveBeenCalled()
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'uploading',
      handoff: { url: `https://fake.r2/${id}/upload?ct=audio/mp4`, attempts: 0 },
    })
  })
})

describe('pageWouldUpload', () => {
  const nowMs = 1_800_000_000_000
  const live: UploadHandoff = {
    url: 'https://fake.r2/r1/upload',
    confirm_token: 'token',
    content_type: 'audio/mp4',
    expires_at: nowMs + 60_000,
    attempts: 0,
  }

  it.each<[string, Partial<RecordingFile>, boolean]>([
    ['a file with no hand-off', {}, true],
    ['a live hand-off', { handoff: live }, false],
    ['an expired hand-off', { handoff: { ...live, expires_at: nowMs } }, true],
    [
      'a hand-off the worker failed too often',
      { handoff: { ...live, attempts: HANDOFF_TAKE_BACK_ATTEMPTS } },
      true,
    ],
    ['a hand-off whose confirm the server refused', { handoff: { ...live, refused: true } }, true],
    ['a file that must be split', { local_duration_ms: MAX_RECORDING_MS + 1 }, false],
  ])('%s', (_name, extra, expected) => {
    const file = recordingFile('r1', { local_state: 'uploading', ...extra })
    expect(pageWouldUpload(recordingRow('r1'), file, null, nowMs)).toBe(expected)
  })
})

describe('a stopped pass', () => {
  it.each([
    {
      pass: 'uploadPass',
      setup: async () => {
        const ids = [await captured(), await captured()]
        for (const id of ids) await pushed(id)
        for (const id of ids) await db.recording_files.update(id, { local_state: 'captured' })
        return vi.spyOn(fake.api, 'requestUploadSlot')
      },
      run: (isStopped: () => boolean) =>
        uploadPass(db, fake.api, createUploadReports(noopAnalytics), isStopped),
    },
    {
      pass: 'downloadPass',
      setup: async () => {
        await readyOnServer('r1')
        await readyOnServer('r2')
        await setKeepOffline(db, true)
        return vi.spyOn(fake.api, 'downloadUrl')
      },
      run: (isStopped: () => boolean) => downloadPass(db, fake.api, { isStopped }),
    },
  ])('$pass sends nothing for the rows after a stop', async ({ setup, run }) => {
    const requests = await setup()
    await run(() => requests.mock.calls.length > 0)
    expect(requests).toHaveBeenCalledTimes(1)
  })
})

describe('transfers under the plan', () => {
  const premiumRequired = () =>
    new ApiError(403, { type: PREMIUM_REQUIRED_PROBLEM, title: 't', status: 403, detail: 'd' })

  it('requests no slot for a captured recording while the plan is free', async () => {
    await db.entitlements.put(entitlementRow())
    const id = await captured()
    await db.outbox.clear()
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    expect(await uploadPass(db, fake.api, createUploadReports(noopAnalytics))).toBeNull()
    expect(slot).not.toHaveBeenCalled()
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'captured',
      error: null,
      upload_attempts: 0,
    })
  })

  it('leaves a recording refused for Premium as it was and carries on with the pass', async () => {
    const first = await captured()
    const second = await captured()
    await readyOnServer('r1')
    await setKeepOffline(db, true)
    fake.failSlot(premiumRequired())
    const slot = vi.spyOn(fake.api, 'requestUploadSlot')
    const analytics = recordingAnalytics()
    const engine = createSyncEngine({ analytics, db, api: fake.api, isOnline: () => true })
    await syncAndTransfer(engine)
    engine.stop()

    expect(engine.status()).toBe('idle')
    expect(engine.transferStatus()).toBe('idle')
    expect(analytics.sends()).toEqual([])
    // The refusal speaks for the plan, so the rest of the recordings wait too.
    expect(slot).toHaveBeenCalledTimes(1)
    for (const id of [first, second]) {
      expect(await db.recording_files.get(id)).toMatchObject({
        local_state: 'captured',
        error: null,
        upload_attempts: 0,
        next_attempt_at: null,
      })
    }
    expect(await (await db.recording_files.get('r1'))?.blob?.text()).toBe('xyz')
  })

  it('downloads recordings for Keep offline while the plan is free', async () => {
    await db.entitlements.put(entitlementRow())
    await readyOnServer('r1')
    await setKeepOffline(db, true)
    const spy = vi.spyOn(fake.api, 'downloadUrl')
    await downloadPass(db, fake.api)
    expect(spy).toHaveBeenCalled()
    expect((await db.recording_files.get('r1'))?.blob).toBeDefined()
  })
})

describe('recoverInterruptedCaptures', () => {
  it('assembles leftover chunks into a captured recording once they go stale', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    await db.recording_files.update(id, { last_chunk_at: Date.now() - STALE_CAPTURE_MS - 1 })
    await recoverInterruptedCaptures(db)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    expect((await db.recordings.get(id))?.source).toBe('microphone')
  })

  it('estimates the duration from the chunk count when the recorder never reported one', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    await appendChunk(db, id, 1, new Blob(['cd'], { type: 'audio/mp4' }))
    await db.recording_files.update(id, { last_chunk_at: Date.now() - STALE_CAPTURE_MS - 1 })
    await recoverInterruptedCaptures(db)
    expect((await db.recording_files.get(id))?.local_duration_ms).toBe(2 * CHUNK_MS)
  })

  it('leaves a capture with a recent chunk alone', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    await recoverInterruptedCaptures(db)
    expect((await db.recording_files.get(id))?.local_state).toBe('capturing')
  })

  it('drops a stale capture that produced no chunks', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await db.recording_files.update(id, { last_chunk_at: Date.now() - STALE_CAPTURE_MS - 1 })
    await recoverInterruptedCaptures(db)
    expect(await db.recording_files.get(id)).toBeUndefined()
  })

  it('files a recovered recording under the tune it began with, stamped at its start', async () => {
    const { tuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    const id = newId()
    await beginCapture(db, id, { tuneId, recordedAt: AT })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    await db.recording_files.update(id, { last_chunk_at: Date.now() - STALE_CAPTURE_MS - 1 })
    await recoverInterruptedCaptures(db)
    expect(await db.recordings.get(id)).toMatchObject({ tune_id: tuneId, recorded_at: AT })
  })

  it('files a recovered recording as unfiled when the tune it began with was deleted', async () => {
    const { tuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    const id = newId()
    await beginCapture(db, id, { tuneId, recordedAt: AT })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    await deleteTune(db, tuneId)
    await db.recording_files.update(id, { last_chunk_at: Date.now() - STALE_CAPTURE_MS - 1 })
    await recoverInterruptedCaptures(db)
    expect(await db.recordings.get(id)).toMatchObject({ tune_id: null, recorded_at: AT })
  })
})

describe('recoverInterruptedCaptures with a lock manager', () => {
  it('never recovers a row whose capture lock is held, however old its last chunk', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    await db.recording_files.update(id, { last_chunk_at: Date.now() - 10 * 60_000 })
    const locks = new FakeLockManager()
    const release = await acquireCaptureLock(id, locks)
    await recoverInterruptedCaptures(db, Date.now(), locks)
    expect((await db.recording_files.get(id))?.local_state).toBe('capturing')
    release()
  })

  it('recovers a row with no held lock once its last chunk is older than the grace', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    await db.recording_files.update(id, {
      last_chunk_at: Date.now() - CAPTURE_LOCK_GRACE_MS - 1,
    })
    const locks = new FakeLockManager()
    await recoverInterruptedCaptures(db, Date.now(), locks)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
  })

  it('leaves a row with no held lock alone while its last chunk is inside the grace', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    const locks = new FakeLockManager()
    await recoverInterruptedCaptures(db, Date.now(), locks)
    expect((await db.recording_files.get(id))?.local_state).toBe('capturing')
  })

  it('falls back to the 30-second rule when there is no lock manager', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    await db.recording_files.update(id, {
      last_chunk_at: Date.now() - CAPTURE_LOCK_GRACE_MS - 1,
    })
    await recoverInterruptedCaptures(db, Date.now(), undefined)
    // Past the 10s lock grace but still inside the 30s rule this falls back to.
    expect((await db.recording_files.get(id))?.local_state).toBe('capturing')
  })
})

describe('joinChunkedCaptures', () => {
  it('joins a finished capture only while the copy leaves the room kept for recording', async () => {
    const id = await captured()
    await joinChunkedCaptures(db, { headroom: async () => CAPTURE_RESERVE_BYTES + 3 - 1 })
    expect(await db.recording_files.get(id)).toMatchObject({ chunked: true, blob: null })

    await joinChunkedCaptures(db, { headroom: async () => null })
    const file = await db.recording_files.get(id)
    expect(file?.chunked).toBe(false)
    expect(await file?.blob?.text()).toBe('abc')
  })

  it('leaves the chunks of a file the service worker is sending', async () => {
    const id = await captured()
    const handoff: UploadHandoff = {
      url: 'https://r2.example/put',
      confirm_token: 'token',
      content_type: 'audio/mp4',
      expires_at: Date.now() + 60_000,
      attempts: 0,
    }
    await db.recording_files.update(id, { local_state: 'uploading', handoff })
    await joinChunkedCaptures(db, { headroom: async () => null })
    expect(await db.recording_files.get(id)).toMatchObject({ chunked: true, blob: null })
  })
})

describe('downloads', () => {
  it('downloadPass fetches every ready recording without a blob once keep offline is on', async () => {
    await readyOnServer('r1')
    await readyOnServer('r2')
    await setKeepOffline(db, true)
    await downloadPass(db, fake.api)
    expect(await (await db.recording_files.get('r1'))?.blob?.text()).toBe('xyz')
    expect(await (await db.recording_files.get('r2'))?.blob?.text()).toBe('xyz')
  })

  it('downloadPass leaves out a download that would use the room kept for recording, and says so', async () => {
    await readyOnServer('r1')
    await setKeepOffline(db, true)
    const short = async () => CAPTURE_RESERVE_BYTES + 3 - 1
    await downloadPass(db, fake.api, { headroom: short })
    expect(hasLocalAudio(await db.recording_files.get('r1'))).toBe(false)
    expect(await getDownloadsHeldForSpace(db)).toBe(true)

    await downloadPass(db, fake.api, { headroom: async () => CAPTURE_RESERVE_BYTES + 3 })
    expect(hasLocalAudio(await db.recording_files.get('r1'))).toBe(true)
    expect(await getDownloadsHeldForSpace(db)).toBe(false)
  })

  it('downloadPass waits out a failed download backoff before trying it again', async () => {
    await readyOnServer('r1')
    await setKeepOffline(db, true)
    let now = 1_000_000
    const retries = createDownloadRetries(() => now)
    const spy = vi.spyOn(fake.api, 'downloadUrl').mockRejectedValueOnce(new Error('boom'))

    await downloadPass(db, fake.api, { retries })
    await downloadPass(db, fake.api, { retries })
    expect(spy).toHaveBeenCalledTimes(1)

    now += retryDelayMs(0)
    await downloadPass(db, fake.api, { retries })
    expect(spy).toHaveBeenCalledTimes(2)
    expect(await (await db.recording_files.get('r1'))?.blob?.text()).toBe('xyz')
  })

  it('downloadPass fetches nothing while keep offline is off', async () => {
    await readyOnServer('r1')
    const spy = vi.spyOn(fake.api, 'downloadUrl')
    await downloadPass(db, fake.api)
    expect(spy).not.toHaveBeenCalled()
    expect(await db.recording_files.get('r1')).toBeUndefined()
  })

  it('downloads a recording pulled after keep offline was turned on', async () => {
    await setKeepOffline(db, true)
    // The row lands after the setting, with no file row of its own yet.
    await readyOnServer('r1')
    await downloadPass(db, fake.api)
    expect(await (await db.recording_files.get('r1'))?.blob?.text()).toBe('xyz')
  })

  it('downloadOne returns the local blob when present and fetches otherwise', async () => {
    await readyOnServer('r1')
    const fetched = await downloadOne(db, fake.api, 'r1')
    expect(await fetched?.text()).toBe('xyz')
    fake.fail(new NetworkError(new TypeError('x')))
    const local = await downloadOne(db, fake.api, 'r1')
    expect(await local?.text()).toBe('xyz')
  })

  it('downloadOne returns null when the recording is not ready', async () => {
    await readyOnServer('r1')
    await db.recordings.update('r1', { state: 'processing' })
    expect(await downloadOne(db, fake.api, 'r1')).toBeNull()
  })

  it('leaves no file row when a download for a never-fetched recording fails', async () => {
    await readyOnServer('r1')
    fake.fail(new NetworkError(new TypeError('x')))
    await expect(downloadOne(db, fake.api, 'r1')).rejects.toBeInstanceOf(NetworkError)
    expect(await db.recording_files.get('r1')).toBeUndefined()
  })

  it("restores the row's own state on a download failure instead of downloaded", async () => {
    const id = await captured()
    await pushed(id)
    await db.recordings.update(id, { state: 'ready' })
    await db.recording_files.update(id, { blob: null, bytes: 0 })
    fake.recordingStates.set(id, 'ready')
    fake.fail(new NetworkError(new TypeError('x')))
    await expect(downloadOne(db, fake.api, id)).rejects.toBeInstanceOf(NetworkError)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it("does not let one row's storage failure block the rest of the pass", async () => {
    await readyOnServer('r1')
    await readyOnServer('r2')
    await clearedDownload('r1')
    await setKeepOffline(db, true)
    const putSpy = vi.spyOn(db.recording_files, 'put').mockRejectedValueOnce(new Error('disk full'))
    try {
      await downloadPass(db, fake.api)
    } finally {
      putSpy.mockRestore()
    }
    expect(await db.recording_files.get('r1')).toMatchObject({
      local_state: 'downloaded',
      error: 'disk full',
    })
    expect(await (await db.recording_files.get('r2'))?.blob?.text()).toBe('xyz')
  })

  it('stores nothing when the recording is deleted while its download is in flight', async () => {
    await readyOnServer('r1')
    const getObject = fake.api.getObject.bind(fake.api)
    vi.spyOn(fake.api, 'getObject').mockImplementationOnce(async (url) => {
      await deleteRecording(db, 'r1')
      return getObject(url)
    })
    expect(await downloadOne(db, fake.api, 'r1')).toBeNull()
    expect(await db.recording_files.get('r1')).toBeUndefined()
  })

  it('downloadOne recovers a row stuck downloading instead of leaving it stuck', async () => {
    await readyOnServer('r1')
    await clearedDownload('r1')
    await db.recording_files.update('r1', { local_state: 'downloading' })
    fake.fail(new NetworkError(new TypeError('x')))
    await expect(downloadOne(db, fake.api, 'r1')).rejects.toBeInstanceOf(NetworkError)
    expect((await db.recording_files.get('r1'))?.local_state).toBe('downloaded')
  })

  it('downloadPass recovers a row stuck downloading instead of leaving it stuck', async () => {
    await readyOnServer('r1')
    await readyOnServer('r2')
    await clearedDownload('r1')
    await setKeepOffline(db, true)
    await db.recording_files.update('r1', { local_state: 'downloading' })
    const putSpy = vi.spyOn(db.recording_files, 'put').mockRejectedValueOnce(new Error('disk full'))
    try {
      await downloadPass(db, fake.api)
    } finally {
      putSpy.mockRestore()
    }
    expect((await db.recording_files.get('r1'))?.local_state).toBe('downloaded')
    expect(await (await db.recording_files.get('r2'))?.blob?.text()).toBe('xyz')
  })
})

describe('stale files and peaks downloads', () => {
  it('a captured blob is never stale', async () => {
    const id = await captured()
    const file = (await db.recording_files.get(id))!
    const row = (await db.recordings.get(id))!
    expect(isStale(row, file)).toBe(false)

    // Not stale even once the recording is ready and carries a real revision: this
    // blob was never downloaded from the server, so it has no revision to compare.
    await db.recordings.update(id, { state: 'ready', playback_rev: 'rev-1' })
    const ready = (await db.recordings.get(id))!
    expect(isStale(ready, file)).toBe(false)
  })

  it('a blob from an old revision is refetched on download', async () => {
    await readyOnServer('r1')
    await db.recordings.update('r1', { playback_rev: 'rev-new', playback_start_ms: 500 })
    await storeDownloadedBlob(db, 'r1', new Blob(['old']), 'audio/mp4', 'rev-old', 0)
    fake.signDownload('r1', 'rev-new', 500)

    const blob = await downloadOne(db, fake.api, 'r1')
    expect(await blob?.text()).toBe('xyz')
    expect(await db.recording_files.get('r1')).toMatchObject({
      blob_rev: 'rev-new',
      blob_start_ms: 500,
    })
  })

  it("stores the revision and start the server actually signed, not the row's own", async () => {
    // The row here is what a prior pull left behind; the download endpoint's own row can
    // already be ahead of it, as when a trim commits between the pull and this download.
    await readyOnServer('r1')
    await db.recordings.update('r1', { playback_rev: 'rev-pulled', playback_start_ms: 0 })
    fake.signDownload('r1', 'rev-signed', 750)

    await downloadOne(db, fake.api, 'r1')
    expect(await db.recording_files.get('r1')).toMatchObject({
      blob_rev: 'rev-signed',
      blob_start_ms: 750,
    })

    // Until the pull catches up, the stored blob now reads as stale against the row this
    // device still has, which is correct: it really is a different revision than what was
    // requested.
    const row = (await db.recordings.get('r1'))!
    const file = (await db.recording_files.get('r1'))!
    expect(isStale(row, file)).toBe(true)
  })

  it('the keep-offline pass refetches stale blobs', async () => {
    await readyOnServer('r1')
    await db.recordings.update('r1', { playback_rev: 'rev-new', playback_start_ms: 0 })
    await storeDownloadedBlob(db, 'r1', new Blob(['old']), 'audio/mp4', 'rev-old', 0)
    fake.signDownload('r1', 'rev-new', 0)
    await setKeepOffline(db, true)

    await downloadPass(db, fake.api)
    expect(await (await db.recording_files.get('r1'))?.blob?.text()).toBe('xyz')
    expect((await db.recording_files.get('r1'))?.blob_rev).toBe('rev-new')
  })

  it('peaks are fetched once per revision', async () => {
    await readyOnServer('r1')
    await db.recordings.update('r1', { peaks_rev: 'peaks-1' })
    fake.signPeaks('r1', 'peaks-1')
    fake.objects.set('r1/peaks.bin', new Blob([new Uint8Array([1, 2, 3])]))
    const spy = vi.spyOn(fake.api, 'peaksUrl')

    const first = await fetchPeaks(db, fake.api, 'r1')
    expect(Array.from(first ?? [])).toEqual([1, 2, 3])
    expect(spy).toHaveBeenCalledTimes(1)

    // Same revision, so this reads the cached file instead of asking the server again.
    const second = await fetchPeaks(db, fake.api, 'r1')
    expect(Array.from(second ?? [])).toEqual([1, 2, 3])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("stores the peaks revision the server actually signed, not the row's own", async () => {
    await readyOnServer('r1')
    await db.recordings.update('r1', { peaks_rev: 'peaks-pulled' })
    fake.signPeaks('r1', 'peaks-signed')
    fake.objects.set('r1/peaks.bin', new Blob([new Uint8Array([4, 5, 6])]))

    const peaks = await fetchPeaks(db, fake.api, 'r1')
    expect(Array.from(peaks ?? [])).toEqual([4, 5, 6])
    expect((await db.recording_files.get('r1'))?.peaks_rev).toBe('peaks-signed')
  })

  it("capture-time peaks are replaced when the server's arrive", async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
    await finishCapture(db, id, {
      tuneId: null,
      mime: 'audio/mp4',
      durationMs: 3000,
      recordedAt: AT,
      peaks: new Uint8Array([1, 2, 3]),
    })
    const spy = vi.spyOn(fake.api, 'peaksUrl')

    // A row whose peaks_rev is still null never asks the server; the capture-time
    // waveform is all there is until it does.
    const captureTime = await fetchPeaks(db, fake.api, id)
    expect(Array.from(captureTime ?? [])).toEqual([1, 2, 3])
    expect(spy).not.toHaveBeenCalled()

    await db.recordings.update(id, { state: 'ready', peaks_rev: 'srv-1' })
    fake.recordingStates.set(id, 'ready')
    fake.signPeaks(id, 'srv-1')
    fake.objects.set(`${id}/peaks.bin`, new Blob([new Uint8Array([9, 9, 9])]))

    const fromServer = await fetchPeaks(db, fake.api, id)
    expect(Array.from(fromServer ?? [])).toEqual([9, 9, 9])
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('createSyncEngine recovery and downloads', () => {
  it('never recovers a live capture whose last chunk is still fresh, across engines', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    const engine1 = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await engine1.sync()
    await engine1.sync()
    // A second engine instance (another tab, or a provider remount) is just as live a reader.
    const engine2 = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await engine2.sync()
    expect((await db.recording_files.get(id))?.local_state).toBe('capturing')
    expect(await db.recording_chunks.where('recording_id').equals(id).count()).toBe(1)
  })

  it('recovers a capture on a later sync once it goes stale, not just the first', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await engine.sync()
    expect((await db.recording_files.get(id))?.local_state).toBe('capturing')
    await db.recording_files.update(id, { last_chunk_at: Date.now() - STALE_CAPTURE_MS - 1 })
    await syncAndTransfer(engine)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('reports a held upload error on the transfer status and leaves catalog sync idle', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(500, null))
    fake.queuePull({
      rows: [{ table: 'tunes', row: serverTune({ id: 'srv-tune', server_seq: 1 }) }],
      next_since: 1,
      has_more: false,
    })
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await syncAndTransfer(engine)
    expect(await db.tunes.get('srv-tune')).toBeTruthy()
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    expect(engine.status()).toBe('idle')
    expect(engine.transferStatus()).toBe('error')
    engine.stop()
  })

  it('reports a network failure from putObject as a transfer error without blocking pull', async () => {
    const id = await captured()
    fake.failPut(new NetworkError(new TypeError('x')), id)
    fake.queuePull({
      rows: [{ table: 'tunes', row: serverTune({ id: 'srv-tune', server_seq: 1 }) }],
      next_since: 1,
      has_more: false,
    })
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await syncAndTransfer(engine)
    expect(await db.tunes.get('srv-tune')).toBeTruthy()
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    expect(engine.status()).toBe('idle')
    // The browser says it is online, so a failed PUT is the storage host refusing, not a lost signal.
    expect(engine.transferStatus()).toBe('error')
    engine.stop()
  })

  it('runs one getObject call for two concurrent download() calls on the same id', async () => {
    await readyOnServer('r1')
    const getObjectSpy = vi.spyOn(fake.api, 'getObject')
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    const [a, b] = await Promise.all([engine.download('r1'), engine.download('r1')])
    expect(await a?.text()).toBe('xyz')
    expect(await b?.text()).toBe('xyz')
    expect(getObjectSpy).toHaveBeenCalledTimes(1)
  })

  it('leaves status idle when refreshing storage fails after a clean push and pull', async () => {
    vi.spyOn(fake.api, 'me').mockRejectedValue(new NetworkError(new TypeError('x')))
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await engine.sync()
    expect(engine.status()).toBe('idle')
  })
})

describe('engine.peaks', () => {
  it('returns the local peaks while offline, without asking the server', async () => {
    await readyOnServer('r1')
    await db.recordings.update('r1', { peaks_rev: 'srv-1' })
    await storePeaks(db, 'r1', new Uint8Array([1, 2, 3]), 'srv-1')
    const peaksSpy = vi.spyOn(fake.api, 'peaksUrl')
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => false,
    })

    const peaks = await engine.peaks('r1')
    expect(Array.from(peaks ?? [])).toEqual([1, 2, 3])
    expect(peaksSpy).not.toHaveBeenCalled()
  })

  it('runs one peaksUrl call for two concurrent calls on the same id', async () => {
    await readyOnServer('r1')
    await db.recordings.update('r1', { peaks_rev: 'srv-1' })
    fake.signPeaks('r1', 'srv-1')
    fake.objects.set('r1/peaks.bin', new Blob([new Uint8Array([4, 5, 6])]))
    const peaksSpy = vi.spyOn(fake.api, 'peaksUrl')
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })

    const [a, b] = await Promise.all([engine.peaks('r1'), engine.peaks('r1')])
    expect(Array.from(a ?? [])).toEqual([4, 5, 6])
    expect(Array.from(b ?? [])).toEqual([4, 5, 6])
    expect(peaksSpy).toHaveBeenCalledTimes(1)
  })

  it('returns null instead of throwing when the fetch fails', async () => {
    await readyOnServer('r1')
    await db.recordings.update('r1', { peaks_rev: 'srv-1' })
    fake.signPeaks('r1', 'srv-1')
    // No object staged at the peaks key, so getObject rejects with a transfer error.
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })

    expect(await engine.peaks('r1')).toBeNull()
  })
})

describe('fakeApi retryRecording', () => {
  it('answers 409 for a recording that was never uploaded, matching the real route', async () => {
    fake.recordingStates.set('r1', 'pending_upload')
    await expect(fake.api.retryRecording('r1')).rejects.toMatchObject({ status: 409 })
  })

  it('succeeds without change for a recording already retried, matching the real route', async () => {
    fake.recordingStates.set('r1', 'uploaded')
    await expect(fake.api.retryRecording('r1')).resolves.toBeUndefined()
    expect(fake.recordingStates.get('r1')).toBe('uploaded')
  })

  it('retries a failed recording', async () => {
    fake.recordingStates.set('r1', 'failed')
    await expect(fake.api.retryRecording('r1')).resolves.toBeUndefined()
    expect(fake.recordingStates.get('r1')).toBe('uploaded')
  })
})

describe('engine integration', () => {
  it('runs recovery and the account refresh in the sync, then uploads and downloads after it', async () => {
    const id = await captured()
    await readyOnServer('r1')
    await setKeepOffline(db, true)
    fake.setStorage({ used_bytes: 42, quota_bytes: 100, max_file_bytes: 50 })
    fake.setCountryCenter({ lat: 51.2, lon: 10.4 })
    const stray = newId()
    await beginCapture(db, stray, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, stray, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    // A stale last chunk is what makes an abandoned capture, not merely having one.
    await db.recording_files.update(stray, { last_chunk_at: Date.now() - STALE_CAPTURE_MS - 1 })

    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await engine.sync()
    expect(await getStorage(db)).toEqual({
      used_bytes: 42,
      quota_bytes: 100,
      max_file_bytes: 50,
      split_parent_max_file_bytes: 1_800_000_000,
    })
    expect(await getCountryCenter(db)).toEqual({ lat: 51.2, lon: 10.4 })
    await transfersSettled(engine)

    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
    expect(await (await db.recording_files.get('r1'))?.blob?.text()).toBe('xyz')
    // Recovery ran before push, so the stray capture's row was pushed in time to upload.
    expect((await db.recording_files.get(stray))?.local_state).toBe('uploaded')
  })
})

describe('upload reporting', () => {
  const refusal = (status: number) =>
    new ApiError(status, { type: 'about:blank', title: 't', status, detail: 'd' })
  const quota = () =>
    new ApiError(413, { type: QUOTA_PROBLEM, title: 't', status: 413, detail: 'full' })

  /** A full sync and transfer, as the app runs it, reporting to `analytics`. */
  async function runEngine(analytics: ReturnType<typeof recordingAnalytics>): Promise<void> {
    const engine = createSyncEngine({ analytics, db, api: fake.api, isOnline: () => true })
    await syncAndTransfer(engine)
    engine.stop()
  }

  it.each([
    ['network', () => new NetworkError(new TypeError('Failed to fetch')), 'network'],
    ['a server error', () => refusal(503), 'server_error'],
    ['an expired session', () => refusal(401), 'auth_expired'],
    ['a refused request', () => refusal(422), 'other'],
  ] as const)('upload_failed maps %s, recordings only', async (_label, make, reason) => {
    await captured()
    fake.failSlot(make())
    const analytics = recordingAnalytics()

    await runEngine(analytics)

    expect(analytics.sends()).toEqual([
      { name: 'upload_failed', props: { failure_reason: reason, origin: 'recorded' } },
    ])
  })

  it('upload_failed reports an upload that fails after the slot, with the recording origin', async () => {
    const id = await captured()
    await db.recordings.update(id, { source: 'upload' })
    await db.outbox.toCollection().modify((entry) => {
      if (entry.row_id === id) entry.data = { ...entry.data, source: 'upload' }
    })
    fake.failPut(new NetworkError(new TypeError('x')), id)
    const analytics = recordingAnalytics()

    await runEngine(analytics)

    expect(analytics.sends()).toEqual([
      { name: 'upload_failed', props: { failure_reason: 'network', origin: 'imported' } },
    ])
  })

  it('upload_failed is sent once for consecutive failures, not for each retry', async () => {
    const id = await captured()
    fake.failSlot(refusal(500))
    await pushed(id)
    const analytics = recordingAnalytics()
    const reports = createUploadReports(analytics)

    await uploadPass(db, fake.api, reports)
    expect((await db.recording_files.get(id))?.upload_attempts).toBe(1)
    await db.recording_files.update(id, { next_attempt_at: null })
    await uploadPass(db, fake.api, reports)
    expect((await db.recording_files.get(id))?.upload_attempts).toBe(2)

    expect(analytics.sends()).toHaveLength(1)
  })

  it('upload_failed is sent again for a failure after a success', async () => {
    const id = await captured()
    fake.failSlot(refusal(500))
    await pushed(id)
    const analytics = recordingAnalytics()
    const reports = createUploadReports(analytics)

    await uploadPass(db, fake.api, reports)
    fake.failSlot(null)
    await db.recording_files.update(id, { next_attempt_at: null })
    await uploadPass(db, fake.api, reports)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')

    // The same file, queued again and failing again, starts a new run of failures.
    await db.recordings.update(id, { state: 'pending_upload' })
    await db.recording_files.update(id, { local_state: 'captured' })
    fake.failSlot(refusal(500))
    await uploadPass(db, fake.api, reports)
    expect((await db.recording_files.get(id))?.upload_attempts).toBe(1)

    expect(analytics.sends()).toHaveLength(2)
  })

  it('upload_failed is never sent while offline', async () => {
    const ids = [await captured(), await captured(), await captured()]
    fake.failSlot(new NetworkError(new TypeError('Failed to fetch')))
    await pushed(ids[0]!)
    for (const id of ids) await db.recording_files.update(id, { next_attempt_at: null })
    const analytics = recordingAnalytics()

    await uploadPass(
      db,
      fake.api,
      createUploadReports(analytics, () => false),
    )
    for (const id of ids) {
      expect((await db.recording_files.get(id))?.upload_attempts).toBeGreaterThan(0)
    }

    expect(analytics.sends()).toEqual([])
  })

  it('storage_limit_reached once per run of blocked attempts with storage_used', async () => {
    const id = await captured()
    fake.setStorage({ used_bytes: 20_000_000, quota_bytes: 25_000_000, max_file_bytes: 50 })
    fake.failSlot(quota())
    const analytics = recordingAnalytics()

    await runEngine(analytics)
    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    await uploadPass(db, fake.api, createUploadReports(analytics))
    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')

    expect(analytics.sends()).toEqual([
      { name: 'storage_limit_reached', props: { storage_used: '10-50MB' } },
    ])

    // A blocked file that goes through ends the run.
    fake.failSlot(null)
    await uploadPass(db, fake.api, createUploadReports(analytics))
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
    await captured()
    fake.setStorage({ used_bytes: 60_000_000, quota_bytes: 70_000_000, max_file_bytes: 50 })
    fake.failSlot(quota())
    await runEngine(analytics)

    expect(analytics.sends()).toEqual([
      { name: 'storage_limit_reached', props: { storage_used: '10-50MB' } },
      { name: 'storage_limit_reached', props: { storage_used: '50-500MB' } },
    ])
  })

  it('upload_failed is sent again after a blocked upload ends the consecutive failures', async () => {
    const id = await captured()
    fake.failSlot(refusal(500))
    await pushed(id)
    const analytics = recordingAnalytics()
    const reports = createUploadReports(analytics)

    await uploadPass(db, fake.api, reports)
    fake.failSlot(quota())
    await db.recording_files.update(id, { next_attempt_at: null })
    await uploadPass(db, fake.api, reports)
    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    fake.failSlot(refusal(500))
    await uploadPass(db, fake.api, reports)
    expect((await db.recording_files.get(id))?.upload_attempts).toBe(1)

    expect(analytics.sends().map((send) => send.name)).toEqual([
      'upload_failed',
      'storage_limit_reached',
      'upload_failed',
    ])
  })

  it('upload_failed is not sent for a missing session token', async () => {
    const id = await captured()
    fake.failSlot(new NoTokenError())
    const analytics = recordingAnalytics()

    await runEngine(analytics)

    expect((await db.recording_files.get(id))?.upload_attempts).toBe(1)
    expect(analytics.sends()).toEqual([])
  })

  it('a storage usage read failure never changes the upload outcome', async () => {
    const id = await captured()
    fake.failSlot(quota())
    await pushed(id)
    await db.recording_files.update(id, { local_state: 'captured' })
    // The pass reads storage usage once itself; the report is the second read.
    vi.spyOn(db.meta, 'get')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('read failed'))
    const analytics = recordingAnalytics()

    expect(await uploadPass(db, fake.api, createUploadReports(analytics))).toBeNull()

    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    expect(analytics.sends()).toEqual([])
  })

  it('storage_limit_reached is not sent without storage usage', async () => {
    const id = await captured()
    fake.failSlot(quota())
    const analytics = recordingAnalytics()
    // As if storage usage had never been fetched: the pass reads them from the db.
    vi.spyOn(fake.api, 'me').mockRejectedValue(new ApiError(500, null))

    await runEngine(analytics)

    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    expect(analytics.sends()).toEqual([])
  })

  it('reports a permanent refusal once', async () => {
    const id = await captured()
    fake.failSlot(refusal(422))
    const analytics = recordingAnalytics()

    await runEngine(analytics)

    expect((await db.recording_files.get(id))?.local_state).toBe('failed_upload')
    expect(analytics.sends()).toEqual([
      { name: 'upload_failed', props: { failure_reason: 'other', origin: 'recorded' } },
    ])
  })
})
