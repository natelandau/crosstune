import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from '../api/client'
import {
  appendChunk,
  beginCapture,
  finishCapture,
  storeDownloadedBlob,
} from '../commands/recordings'
import { createTune, deleteTune } from '../commands/tunes'
import { CHUNK_MS } from '../db/recordings'
import { getStorage, setKeepOffline, setStorage } from '../db/meta'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { newId } from '../commands/write'
import { openTestDb } from '../test/db'
import { createFakeApi, serverRecording, serverTune } from '../test/fakeApi'
import { applyPullPage } from './apply'
import { FakeLockManager } from '../test/fakeLocks'
import { acquireCaptureLock } from './captureLock'
import { createSyncEngine } from './engine'
import type { SyncEngine } from './types'
import {
  CAPTURE_LOCK_GRACE_MS,
  downloadOne,
  downloadPass,
  QUOTA_PROBLEM,
  recoverInterruptedCaptures,
  STALE_CAPTURE_MS,
  uploadPass,
} from './transfers'

let db: CrosstuneDb
let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  db = openTestDb()
  fake = createFakeApi()
})

afterEach(async () => {
  await db.delete()
})

const AT = '2026-09-14T20:00:00.000Z'

async function captured(): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
  await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
  await finishCapture(db, id, { tuneId: null, mime: 'audio/mp4', durationMs: 3000, recordedAt: AT })
  return id
}

/** Resolves once the transfer loop a sync started has finished its pass. */
function transfersSettled(engine: SyncEngine): Promise<void> {
  if (engine.transferStatus() !== 'transferring') return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = engine.subscribeTransfer((status) => {
      if (status === 'transferring') return
      unsubscribe()
      resolve()
    })
  })
}

async function syncAndTransfer(engine: SyncEngine): Promise<void> {
  await engine.sync()
  await transfersSettled(engine)
}

async function pushed(id: string): Promise<void> {
  const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
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
  await storeDownloadedBlob(db, id, new Blob(['old']), 'audio/mp4')
  await db.recording_files.update(id, { blob: null, bytes: 0 })
}

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
    recorded_at: AT,
    position: 0,
    state: 'ready',
    duration_ms: 3000,
    playback_mime: 'audio/mp4',
    playback_bytes: 3,
    error: null,
  })
  fake.recordingStates.set(id, 'ready')
  fake.objects.set(`${id}/playback.m4a`, new Blob(['xyz'], { type: 'audio/mp4' }))
}

describe('uploadPass', () => {
  it('waits until the row has been pushed', async () => {
    const id = await captured()
    await uploadPass(db, fake.api)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    expect(fake.objects.size).toBe(0)
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
    await uploadPass(db, fake.api)
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
    await uploadPass(db, fake.api)
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
    await expect(uploadPass(db, fake.api)).resolves.toBeInstanceOf(ApiError)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
  })

  it('resets to captured and holds the error when storage is not configured on the server', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(503, null))
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    await expect(uploadPass(db, fake.api)).resolves.toBeInstanceOf(ApiError)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
  })

  it('holds a network failure from the slot request as the pass error instead of aborting', async () => {
    const id = await captured()
    fake.failSlot(new NetworkError(new TypeError('x')))
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('captured')
    await expect(uploadPass(db, fake.api)).resolves.toBeInstanceOf(NetworkError)
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
    await uploadPass(db, fake.api)
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
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => online })
    await engine.transfer()
    expect(engine.transferStatus()).toBe('error')
    engine.stop()

    online = false
    await db.recording_files.update(id, { next_attempt_at: null })
    const offline = createSyncEngine({ db, api: fake.api, isOnline: () => online })
    await offline.transfer()
    expect(offline.transferStatus()).toBe('offline')
    offline.stop()
  })

  it('skips a row on backoff instead of requesting a slot again right away', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(500, null))
    await pushed(id)
    await uploadPass(db, fake.api)
    const first = await db.recording_files.get(id)
    expect(first?.upload_attempts).toBe(1)
    expect(first?.next_attempt_at).not.toBeNull()

    const slotSpy = vi.spyOn(fake.api, 'requestUploadSlot')
    await uploadPass(db, fake.api)
    expect(slotSpy).not.toHaveBeenCalled()
    expect((await db.recording_files.get(id))?.upload_attempts).toBe(1)
  })

  it('doubles the backoff delay on each consecutive transient failure', async () => {
    const id = await captured()
    fake.failSlot(new ApiError(500, null))
    await pushed(id)

    await uploadPass(db, fake.api)
    const first = await db.recording_files.get(id)
    const firstDelay = (first?.next_attempt_at ?? 0) - Date.now()
    expect(firstDelay).toBeGreaterThan(25_000)
    expect(firstDelay).toBeLessThanOrEqual(30_000)

    // Past its own backoff window, the row is retried again on the next pass.
    await db.recording_files.update(id, { next_attempt_at: Date.now() - 1 })
    await uploadPass(db, fake.api)
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
    await uploadPass(db, fake.api)
    expect((await db.recording_files.get(id))?.upload_attempts).toBe(1)

    fake.failSlot(null)
    await db.recording_files.update(id, { next_attempt_at: Date.now() - 1 })
    await uploadPass(db, fake.api)
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
    await uploadPass(db, fake.api)
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
    await uploadPass(db, fake.api)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('restores a captured recording as unfiled when a pulled tombstone deletes its tune elsewhere', async () => {
    const { tuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    const id = newId()
    await beginCapture(db, id, { tuneId, recordedAt: AT })
    await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
    await finishCapture(db, id, { tuneId, mime: 'audio/mp4', durationMs: 3000, recordedAt: AT })
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
    await uploadPass(db, fake.api)
    const file = await db.recording_files.get(id)
    expect(file?.local_state).toBe('captured')
    expect(await file?.blob?.text()).toBe('abc')
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
    await uploadPass(db, fake.api)
    expect(await db.recording_files.get(id)).toBeUndefined()
    expect(await pendingFor(db, 'recordings', id)).toBeUndefined()
  })

  it('skips a blocked row until storage figures show room for it', async () => {
    const id = await captured()
    fake.failSlot(
      new ApiError(413, { type: QUOTA_PROBLEM, title: 't', status: 413, detail: 'full' }),
    )
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    fake.failSlot(null)

    await setStorage(db, { used_bytes: 98, quota_bytes: 100, max_file_bytes: 50 })
    await uploadPass(db, fake.api)
    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    expect(fake.objects.has(`${id}/upload`)).toBe(false)

    await setStorage(db, { used_bytes: 50, quota_bytes: 100, max_file_bytes: 50 })
    await uploadPass(db, fake.api)
    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
  })

  it('restores a blocked row whose recording is tombstoned instead of skipping it forever', async () => {
    const id = await captured()
    fake.failSlot(
      new ApiError(413, { type: QUOTA_PROBLEM, title: 't', status: 413, detail: 'full' }),
    )
    await pushed(id)
    expect((await db.recording_files.get(id))?.local_state).toBe('blocked_quota')
    // Figures that would otherwise skip the row without ever reaching the tombstone check.
    await setStorage(db, { used_bytes: 99, quota_bytes: 100, max_file_bytes: 50 })
    await db.recordings.update(id, { deleted_at: AT })
    await uploadPass(db, fake.api)
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
    await uploadPass(db, fake.api)
    expect(await db.recording_files.get(id)).toMatchObject({ local_state: 'captured', error: null })
    expect((await pendingFor(db, 'recordings', id))?.op).toBe('upsert')
  })

  it('drops a file whose recording row was never stored here', async () => {
    const id = await captured()
    await db.recordings.delete(id)
    await uploadPass(db, fake.api)
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
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
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
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await syncAndTransfer(engine)
    expect((await db.recording_files.get(bad))?.local_state).toBe('captured')
    expect((await db.recording_files.get(good))?.local_state).toBe('captured')
    engine.stop()
    // Backoff from the pass above must not suppress the pass this test is about.
    await db.recording_files.update(bad, { upload_attempts: 0, next_attempt_at: null })
    await db.recording_files.update(good, { upload_attempts: 0, next_attempt_at: null })

    fake.failSlot(new ApiError(500, null), bad)
    const held = await uploadPass(db, fake.api)
    expect(held).toBeInstanceOf(ApiError)
    expect((await db.recording_files.get(bad))?.local_state).toBe('captured')
    expect((await db.recording_files.get(good))?.local_state).toBe('uploaded')
  })

  it('returns null when every row in the pass settles', async () => {
    const id = await captured()
    expect(await uploadPass(db, fake.api)).toBeNull()
    await pushed(id)
    expect(await uploadPass(db, fake.api)).toBeNull()
  })

  it('deletes chunks that have no file row or whose file row has moved past capturing', async () => {
    // A genuinely orphaned chunk: no file row was ever created for it.
    await db.recording_chunks.put({ recording_id: 'ghost', idx: 0, blob: new Blob(['x']) })
    // A chunk left behind after its capture already finished.
    const id = await captured()
    await db.recording_chunks.put({ recording_id: id, idx: 99, blob: new Blob(['y']) })
    await uploadPass(db, fake.api)
    expect(await db.recording_chunks.where('recording_id').equals('ghost').count()).toBe(0)
    expect(await db.recording_chunks.where('recording_id').equals(id).count()).toBe(0)
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

describe('downloads', () => {
  it('downloadPass fetches every ready recording without a blob once keep offline is on', async () => {
    await readyOnServer('r1')
    await readyOnServer('r2')
    await setKeepOffline(db, true)
    await downloadPass(db, fake.api)
    expect(await (await db.recording_files.get('r1'))?.blob?.text()).toBe('xyz')
    expect(await (await db.recording_files.get('r2'))?.blob?.text()).toBe('xyz')
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

describe('createSyncEngine recovery and downloads', () => {
  it('never recovers a live capture whose last chunk is still fresh, across engines', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    const engine1 = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine1.sync()
    await engine1.sync()
    // A second engine instance (another tab, or a provider remount) is just as live a reader.
    const engine2 = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine2.sync()
    expect((await db.recording_files.get(id))?.local_state).toBe('capturing')
    expect(await db.recording_chunks.where('recording_id').equals(id).count()).toBe(1)
  })

  it('recovers a capture on a later sync once it goes stale, not just the first', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
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
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
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
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
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
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    const [a, b] = await Promise.all([engine.download('r1'), engine.download('r1')])
    expect(await a?.text()).toBe('xyz')
    expect(await b?.text()).toBe('xyz')
    expect(getObjectSpy).toHaveBeenCalledTimes(1)
  })

  it('leaves status idle when refreshing storage fails after a clean push and pull', async () => {
    vi.spyOn(fake.api, 'me').mockRejectedValue(new NetworkError(new TypeError('x')))
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    expect(engine.status()).toBe('idle')
  })
})

describe('fakeApi retryRecording', () => {
  it('answers 409 for a recording that is not failed, matching the real route', async () => {
    fake.recordingStates.set('r1', 'uploaded')
    await expect(fake.api.retryRecording('r1')).rejects.toMatchObject({ status: 409 })
  })

  it('retries a failed recording', async () => {
    fake.recordingStates.set('r1', 'failed')
    await expect(fake.api.retryRecording('r1')).resolves.toBeUndefined()
    expect(fake.recordingStates.get('r1')).toBe('uploaded')
  })
})

describe('engine integration', () => {
  it('runs recovery and storage refresh in the sync, then uploads and downloads after it', async () => {
    const id = await captured()
    await readyOnServer('r1')
    await setKeepOffline(db, true)
    fake.setStorage({ used_bytes: 42, quota_bytes: 100, max_file_bytes: 50 })
    const stray = newId()
    await beginCapture(db, stray, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, stray, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    // A stale last chunk is what makes an abandoned capture, not merely having one.
    await db.recording_files.update(stray, { last_chunk_at: Date.now() - STALE_CAPTURE_MS - 1 })

    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    expect(await getStorage(db)).toEqual({ used_bytes: 42, quota_bytes: 100, max_file_bytes: 50 })
    await transfersSettled(engine)

    expect((await db.recording_files.get(id))?.local_state).toBe('uploaded')
    expect(await (await db.recording_files.get('r1'))?.blob?.text()).toBe('xyz')
    // Recovery ran before push, so the stray capture's row was pushed in time to upload.
    expect((await db.recording_files.get(stray))?.local_state).toBe('uploaded')
  })
})
