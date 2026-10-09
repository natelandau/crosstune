import { recordingAnalytics } from '../usage/testing'
import { noopAnalytics } from '../usage/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from '../api/client'
import type { ScanRow } from '../api/types'
import { addScans, deleteScan } from '../commands/scans'
import { appendChunk, beginCapture, finishCapture } from '../commands/recordings'
import { createTune, deleteTune } from '../commands/tunes'
import { newId } from '../commands/write'
import { setStorage } from '../db/meta'
import { SCAN_REFUSED_ERROR, SCAN_STORAGE_FULL_ERROR } from '../db/scans'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { transfersSettled } from '../test/transfers'
import { createFakeApi, serverTune } from '../test/fakeApi'
import { applyPullPage } from './apply'
import { createSyncEngine } from './engine'
import { dropTombstonedScanFiles, scanDownloadPass, scanUploadPass } from './scanTransfers'
import { createDownloadRetries, QUOTA_PROBLEM, retryDelayMs } from './transfers'

let db: CrosstuneDb
let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  db = openTestDb()
  fake = createFakeApi()
})

const AT = '2026-10-03T20:00:00.000Z'
const IMAGE = 'jpeg-bytes'

const quotaRefusal = () =>
  new ApiError(413, { type: QUOTA_PROBLEM, title: 't', status: 413, detail: 'full' })

async function capturedScan(): Promise<{ tuneId: string; scanId: string }> {
  const { tuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
  const [scanId] = await addScans(db, tuneId, [
    { blob: new Blob([IMAGE], { type: 'image/jpeg' }), width: 800, height: 1200 },
  ])
  return { tuneId, scanId: scanId! }
}

/** As if every queued row reached the server and was stored there. */
async function pushedEverything(): Promise<void> {
  await db.outbox.clear()
  await db.scans.toCollection().modify({ server_seq: 1 })
}

function serverScan(overrides: Partial<ScanRow> & { id: string; tune_id: string }) {
  return {
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 7,
    user_id: 'server-user',
    position: 0,
    width: 800,
    height: 1200,
    state: 'ready' as const,
    file_bytes: IMAGE.length,
    ...overrides,
  }
}

async function readyOnServer(scanId: string, tuneId = newId()): Promise<void> {
  await applyPullPage(
    db,
    [
      { table: 'tunes', row: serverTune({ id: tuneId }) },
      { table: 'scans', row: serverScan({ id: scanId, tune_id: tuneId }) },
    ],
    5,
  )
  fake.scanStates.set(scanId, 'ready')
  fake.objects.set(`${scanId}/scan.jpg`, new Blob([IMAGE], { type: 'image/jpeg' }))
}

describe('scanUploadPass', () => {
  it('waits until the row has been pushed', async () => {
    const { scanId } = await capturedScan()
    const slot = vi.spyOn(fake.api, 'requestScanUploadSlot')
    expect(await scanUploadPass(db, fake.api)).toBeNull()
    expect(slot).not.toHaveBeenCalled()
    expect(await db.scan_files.get(scanId)).toMatchObject({ origin: 'captured' })
  })

  it('uploads a captured scan after its row is pushed', async () => {
    const { scanId } = await capturedScan()
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await engine.sync()
    await transfersSettled(engine)
    engine.stop()

    expect(await pendingFor(db, 'scans', scanId)).toBeUndefined()
    expect(fake.scanSlots.get(scanId)).toEqual({
      bytes: IMAGE.length,
      content_type: 'image/jpeg',
    })
    expect(await fake.objects.get(`${scanId}/scan.jpg`)?.text()).toBe(IMAGE)
    expect(fake.putTypes.get(`${scanId}/scan.jpg`)).toBe('image/jpeg')
    expect(fake.scanStates.get(scanId)).toBe('ready')
    // The bytes are now what the server holds, so the file is a cache like any download.
    expect(await db.scan_files.get(scanId)).toMatchObject({
      origin: 'downloaded',
      error: null,
      upload_attempts: 0,
      next_attempt_at: null,
    })
  })

  it.each([
    ['a quota refusal', quotaRefusal],
    [
      'a refused request',
      () => new ApiError(422, { type: 'about:blank', title: 't', status: 422, detail: 'd' }),
    ],
    ['a server error', () => new ApiError(500, null)],
  ])('a scan upload failure sends nothing: %s', async (_label, make) => {
    const { scanId } = await capturedScan()
    const analytics = recordingAnalytics()
    const engine = createSyncEngine({ analytics, db, api: fake.api, isOnline: () => true })
    fake.failSlot(make())
    await engine.sync()
    await transfersSettled(engine)
    engine.stop()

    await expect.poll(async () => (await db.scan_files.get(scanId))?.error).not.toBeNull()
    expect(analytics.sends()).toEqual([])
  })

  it('marks storage full on a quota refusal', async () => {
    const { scanId } = await capturedScan()
    await pushedEverything()
    fake.failSlot(quotaRefusal())
    expect(await scanUploadPass(db, fake.api)).toBeNull()
    expect(await db.scan_files.get(scanId)).toMatchObject({
      origin: 'captured',
      error: SCAN_STORAGE_FULL_ERROR,
      next_attempt_at: null,
    })
    expect(await (await db.scan_files.get(scanId))?.blob.text()).toBe(IMAGE)
  })

  it('does not retry a storage-full scan until the storage figures show room', async () => {
    const { scanId } = await capturedScan()
    await pushedEverything()
    fake.failSlot(quotaRefusal())
    await scanUploadPass(db, fake.api)
    fake.failSlot(null)
    const slot = vi.spyOn(fake.api, 'requestScanUploadSlot')

    await setStorage(db, { used_bytes: 99, quota_bytes: 100, max_file_bytes: 50 })
    await scanUploadPass(db, fake.api)
    expect(slot).not.toHaveBeenCalled()
    expect((await db.scan_files.get(scanId))?.error).toBe(SCAN_STORAGE_FULL_ERROR)

    await setStorage(db, { used_bytes: 50, quota_bytes: 100, max_file_bytes: 50 })
    await scanUploadPass(db, fake.api)
    expect(await db.scan_files.get(scanId)).toMatchObject({ origin: 'downloaded', error: null })
  })

  it('settles a scan the server already holds as downloaded on a slot conflict', async () => {
    const { scanId } = await capturedScan()
    await pushedEverything()
    fake.scanStates.set(scanId, 'ready')
    expect(await scanUploadPass(db, fake.api)).toBeNull()
    expect(await db.scan_files.get(scanId)).toMatchObject({ origin: 'downloaded' })
  })

  it('waits for the pull instead of queuing the row again after a remote delete', async () => {
    const { tuneId, scanId } = await capturedScan()
    await pushedEverything()
    fake.failSlot(new ApiError(404, null), scanId)
    expect(await scanUploadPass(db, fake.api)).toBeNull()
    expect(await pendingFor(db, 'scans', scanId)).toBeUndefined()
    expect(await db.scan_files.get(scanId)).toMatchObject({
      origin: 'captured',
      upload_attempts: 1,
    })

    const deletedAt = '2026-10-03T21:00:00.000Z'
    await applyPullPage(
      db,
      [
        {
          table: 'scans',
          row: serverScan({
            id: scanId,
            tune_id: tuneId,
            state: 'pending_upload',
            deleted_at: deletedAt,
            updated_at: deletedAt,
          }),
        },
      ],
      10,
    )
    await scanUploadPass(db, fake.api)
    expect(await db.scan_files.get(scanId)).toBeUndefined()
    expect(await pendingFor(db, 'scans', scanId)).toBeUndefined()
  })

  it('stops retrying a scan whose row the server refused on push', async () => {
    const { scanId } = await capturedScan()
    fake.respondToPush((changes) =>
      changes.map((c) => ({ table: c.table, id: c.id, status: 'invalid', reason: 'scan limit' })),
    )
    fake.failSlot(new ApiError(404, null), scanId)
    const slot = vi.spyOn(fake.api, 'requestScanUploadSlot')
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
      onInvalid: () => {},
    })
    await engine.sync()
    await transfersSettled(engine)
    engine.stop()
    expect(await pendingFor(db, 'scans', scanId)).toBeUndefined()
    expect(slot).toHaveBeenCalledOnce()
    expect(await db.scan_files.get(scanId)).toMatchObject({
      origin: 'captured',
      error: SCAN_REFUSED_ERROR,
      next_attempt_at: null,
    })

    await scanUploadPass(db, fake.api)
    expect(slot).toHaveBeenCalledOnce()
    expect(await db.outbox.count()).toBe(0)
  })

  it('uploads a refused scan once a later push has stored its row', async () => {
    const { scanId } = await capturedScan()
    await pushedEverything()
    await db.scan_files.update(scanId, { error: SCAN_REFUSED_ERROR })
    const slot = vi.spyOn(fake.api, 'requestScanUploadSlot')
    await scanUploadPass(db, fake.api)
    expect(slot).toHaveBeenCalledOnce()
    expect(await db.scan_files.get(scanId)).toMatchObject({ origin: 'downloaded', error: null })
  })

  it('backs off a transient failure, keeps the reason, and holds it as the pass error', async () => {
    const { scanId } = await capturedScan()
    await pushedEverything()
    const failure = new ApiError(500, null)
    fake.failSlot(failure)
    const before = Date.now()
    expect(await scanUploadPass(db, fake.api)).toBe(failure)
    const file = await db.scan_files.get(scanId)
    expect(file).toMatchObject({ origin: 'captured', upload_attempts: 1, error: failure.message })
    expect(file?.next_attempt_at).toBeGreaterThanOrEqual(before + retryDelayMs(0))

    fake.failSlot(null)
    const slot = vi.spyOn(fake.api, 'requestScanUploadSlot')
    await scanUploadPass(db, fake.api)
    expect(slot).not.toHaveBeenCalled()
  })

  it('sends a fresh slot next pass when confirmation reports a conflict', async () => {
    const { scanId } = await capturedScan()
    await pushedEverything()
    fake.failConfirm(new ApiError(409, null))
    expect(await scanUploadPass(db, fake.api)).toBeNull()
    expect(await db.scan_files.get(scanId)).toMatchObject({
      origin: 'captured',
      upload_attempts: 1,
    })
  })

  it('rethrows an auth failure instead of holding it', async () => {
    await capturedScan()
    await pushedEverything()
    const refused = new ApiError(401, null)
    fake.failSlot(refused)
    await expect(scanUploadPass(db, fake.api)).rejects.toBe(refused)
  })
})

describe('dropTombstonedScanFiles', () => {
  it('drops the file of a scan whose tune was deleted elsewhere', async () => {
    const { tuneId, scanId } = await capturedScan()
    await pushedEverything()
    const deletedAt = '2026-10-03T21:00:00.000Z'
    await applyPullPage(
      db,
      [
        {
          table: 'tunes',
          row: serverTune({ id: tuneId, deleted_at: deletedAt, updated_at: deletedAt }),
        },
        {
          table: 'scans',
          row: serverScan({
            id: scanId,
            tune_id: tuneId,
            state: 'pending_upload',
            deleted_at: deletedAt,
            updated_at: deletedAt,
          }),
        },
      ],
      10,
    )
    const slot = vi.spyOn(fake.api, 'requestScanUploadSlot')
    await scanUploadPass(db, fake.api)
    expect(slot).not.toHaveBeenCalled()
    expect(await db.scan_files.get(scanId)).toBeUndefined()
  })

  it('drops the file of a refused scan whose tune was deleted elsewhere', async () => {
    const { tuneId, scanId } = await capturedScan()
    await db.outbox.clear()
    await db.scan_files.update(scanId, { error: SCAN_REFUSED_ERROR })
    const deletedAt = '2026-10-03T21:00:00.000Z'
    await applyPullPage(
      db,
      [
        {
          table: 'tunes',
          row: serverTune({ id: tuneId, deleted_at: deletedAt, updated_at: deletedAt }),
        },
      ],
      10,
    )
    await dropTombstonedScanFiles(db)
    expect(await db.scan_files.get(scanId)).toBeUndefined()
  })

  it('drops the file of a scan whose tune is not on this device', async () => {
    const { tuneId, scanId } = await capturedScan()
    await db.tunes.delete(tuneId)
    await dropTombstonedScanFiles(db)
    expect(await db.scan_files.get(scanId)).toBeUndefined()
  })

  it('drops the file of a scan deleted or whose tune was deleted on this device', async () => {
    const { tuneId, scanId } = await capturedScan()
    const [other] = await addScans(db, tuneId, [{ blob: new Blob(['x']), width: 1, height: 1 }])
    await deleteScan(db, other!)
    await dropTombstonedScanFiles(db)
    expect(await db.scan_files.get(other!)).toBeUndefined()
    expect(await db.scan_files.get(scanId)).toBeDefined()

    await deleteTune(db, tuneId)
    await dropTombstonedScanFiles(db)
    expect(await db.scan_files.get(scanId)).toBeUndefined()
  })
})

describe('scanDownloadPass', () => {
  it('downloads every ready scan with keep offline off', async () => {
    await readyOnServer('p1')
    await readyOnServer('p2')
    await scanDownloadPass(db, fake.api, createDownloadRetries())
    for (const id of ['p1', 'p2']) {
      const file = await db.scan_files.get(id)
      expect(file).toMatchObject({ origin: 'downloaded', error: null })
      expect(await file?.blob.text()).toBe(IMAGE)
    }
  })

  it('skips a scan that is waiting for upload or already has its file', async () => {
    const { scanId } = await capturedScan()
    await readyOnServer('p1')
    await scanDownloadPass(db, fake.api, createDownloadRetries())
    const url = vi.spyOn(fake.api, 'scanDownloadUrl')
    await scanDownloadPass(db, fake.api, createDownloadRetries())
    expect(url).not.toHaveBeenCalled()
    expect(await db.scan_files.get(scanId)).toMatchObject({ origin: 'captured' })
  })

  it('skips a ready scan whose tune is deleted or not on this device', async () => {
    const tuneId = newId()
    await readyOnServer('p1', tuneId)
    await db.tunes.update(tuneId, { deleted_at: AT })
    await readyOnServer('p2')
    await db.tunes.delete((await db.scans.get('p2'))!.tune_id)
    const url = vi.spyOn(fake.api, 'scanDownloadUrl')
    await scanDownloadPass(db, fake.api, createDownloadRetries())
    expect(url).not.toHaveBeenCalled()
    expect(await db.scan_files.count()).toBe(0)
  })

  it('waits out a failed download backoff before trying it again', async () => {
    await readyOnServer('p1')
    let now = 1_000_000
    const retries = createDownloadRetries(() => now)
    const url = vi.spyOn(fake.api, 'scanDownloadUrl').mockRejectedValueOnce(new Error('boom'))

    await scanDownloadPass(db, fake.api, retries)
    await scanDownloadPass(db, fake.api, retries)
    expect(url).toHaveBeenCalledTimes(1)

    now += retryDelayMs(0)
    await scanDownloadPass(db, fake.api, retries)
    expect(url).toHaveBeenCalledTimes(2)
    expect(await db.scan_files.get('p1')).toMatchObject({ origin: 'downloaded' })
  })

  it('stops the pass on a network failure', async () => {
    await readyOnServer('p1')
    const offline = new NetworkError(new TypeError('offline'))
    vi.spyOn(fake.api, 'scanDownloadUrl').mockRejectedValue(offline)
    await expect(scanDownloadPass(db, fake.api, createDownloadRetries())).rejects.toBe(offline)
  })

  it('stores nothing when the scan is deleted while its download is in flight', async () => {
    await readyOnServer('p1')
    const getObject = fake.api.getObject
    vi.spyOn(fake.api, 'getObject').mockImplementation(async (url) => {
      await db.scans.update('p1', { deleted_at: AT })
      return getObject(url)
    })
    await scanDownloadPass(db, fake.api, createDownloadRetries())
    expect(await db.scan_files.get('p1')).toBeUndefined()
  })
})

describe('engine transfers', () => {
  it('still uploads recordings when a scan download fails offline, then reports it', async () => {
    await readyOnServer('p1')
    const recordingId = newId()
    await beginCapture(db, recordingId, { tuneId: null, recordedAt: AT })
    await appendChunk(db, recordingId, 0, new Blob(['abc'], { type: 'audio/mp4' }))
    await finishCapture(db, recordingId, {
      tuneId: null,
      mime: 'audio/mp4',
      durationMs: 3000,
      recordedAt: AT,
      peaks: null,
    })
    vi.spyOn(fake.api, 'scanDownloadUrl').mockRejectedValue(
      new NetworkError(new TypeError('offline')),
    )
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await engine.sync()
    await transfersSettled(engine)
    engine.stop()
    expect(fake.recordingStates.get(recordingId)).toBe('uploaded')
    expect(engine.transferStatus()).toBe('error')
  })

  it('runs scan transfers before recording transfers', async () => {
    await capturedScan()
    const recordingId = newId()
    await beginCapture(db, recordingId, { tuneId: null, recordedAt: AT })
    await appendChunk(db, recordingId, 0, new Blob(['abc'], { type: 'audio/mp4' }))
    await finishCapture(db, recordingId, {
      tuneId: null,
      mime: 'audio/mp4',
      durationMs: 3000,
      recordedAt: AT,
      peaks: null,
    })
    const scanSlot = vi.spyOn(fake.api, 'requestScanUploadSlot')
    const recordingSlot = vi.spyOn(fake.api, 'requestUploadSlot')
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await engine.sync()
    await transfersSettled(engine)
    engine.stop()
    expect(scanSlot).toHaveBeenCalledOnce()
    expect(recordingSlot).toHaveBeenCalledOnce()
    expect(scanSlot.mock.invocationCallOrder[0]).toBeLessThan(
      recordingSlot.mock.invocationCallOrder[0]!,
    )
  })
})
