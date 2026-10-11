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
import { SCAN_REFUSED_ERROR, SCAN_STORAGE_FULL_ERROR, SCAN_TUNE_ONLY_ERROR } from '../db/scans'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { transfersSettled } from '../test/transfers'
import { createFakeApi, serverTune } from '../test/fakeApi'
import { entitlementRow } from '../test/rows'
import { applyPullPage, applyPushResults } from './apply'
import { createSyncEngine } from './engine'
import { SCAN_TUNE_ONLY_PROBLEM, SCAN_TUNE_ONLY_REASON } from './errors'
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

describe('scan transfers under the plan', () => {
  const scanTuneOnly = () =>
    new ApiError(403, { type: SCAN_TUNE_ONLY_PROBLEM, title: 't', status: 403, detail: 'd' })

  /** A stored scan on tune-y, older than any captured here, which makes tune-y the scan tune. */
  async function olderScanElsewhere(): Promise<void> {
    await applyPullPage(
      db,
      [
        { table: 'tunes', row: serverTune({ id: 'tune-y' }) },
        {
          table: 'scans',
          row: serverScan({ id: 'older', tune_id: 'tune-y', created_at: '2026-01-01T00:00:00Z' }),
        },
      ],
      5,
    )
  }

  it('marks a scan refused for being off the scan tune, and retries it once the plan is premium', async () => {
    await olderScanElsewhere()
    const { scanId } = await capturedScan()
    await pushedEverything()
    fake.failSlot(scanTuneOnly())
    expect(await scanUploadPass(db, fake.api)).toBeNull()
    expect(await db.scan_files.get(scanId)).toMatchObject({
      origin: 'captured',
      error: SCAN_TUNE_ONLY_ERROR,
      next_attempt_at: null,
    })

    fake.failSlot(null)
    const slot = vi.spyOn(fake.api, 'requestScanUploadSlot')
    await db.entitlements.put(entitlementRow())
    await scanUploadPass(db, fake.api)
    expect(slot).not.toHaveBeenCalled()
    expect((await db.scan_files.get(scanId))?.error).toBe(SCAN_TUNE_ONLY_ERROR)

    await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
    await scanUploadPass(db, fake.api)
    expect(slot).toHaveBeenCalledOnce()
    expect(await db.scan_files.get(scanId)).toMatchObject({ origin: 'downloaded', error: null })
  })

  it('retries a stored scan refused a slot once its tune becomes the scan tune, once per scan tune', async () => {
    await olderScanElsewhere()
    const { scanId } = await capturedScan()
    await pushedEverything()
    // The trial lapsed after the push stored the row, so its slot is refused.
    await db.entitlements.put(
      entitlementRow({ premium_source: 'trial', premium_expires_at: '2026-02-01T00:00:00.000Z' }),
    )
    fake.failSlot(scanTuneOnly())
    await scanUploadPass(db, fake.api)
    expect((await db.scan_files.get(scanId))?.error).toBe(SCAN_TUNE_ONLY_ERROR)

    const slot = vi.spyOn(fake.api, 'requestScanUploadSlot')
    await scanUploadPass(db, fake.api)
    expect(slot).not.toHaveBeenCalled()

    // The server stored this scan, so it counts toward the scan tune here as it does there.
    await deleteScan(db, 'older')
    await db.outbox.clear()
    await scanUploadPass(db, fake.api)
    expect(slot).toHaveBeenCalledOnce()
    expect((await db.scan_files.get(scanId))?.error).toBe(SCAN_TUNE_ONLY_ERROR)

    await scanUploadPass(db, fake.api)
    expect(slot).toHaveBeenCalledOnce()
  })

  /** A scan the server stores on tune-y, which makes tune-y the scan tune, and a scan added
   * offline on another tune that the server refused on push. */
  async function refusedOffTune(): Promise<string> {
    await applyPullPage(
      db,
      [
        { table: 'tunes', row: serverTune({ id: 'tune-y' }) },
        {
          table: 'scans',
          row: serverScan({ id: 'kept', tune_id: 'tune-y', created_at: '2026-01-01T00:00:00Z' }),
        },
      ],
      5,
    )
    const { scanId } = await capturedScan()
    await db.outbox.clear()
    await db.scan_files.update(scanId, { error: SCAN_TUNE_ONLY_ERROR })
    return scanId
  }

  /** The server refuses the queued scan row again. */
  async function refusedAgain(scanId: string): Promise<void> {
    const sent = (await pendingBatch(db)).filter((entry) => entry.table === 'scans')
    await applyPushResults(db, sent, [
      { table: 'scans', id: scanId, status: 'invalid', reason: SCAN_TUNE_ONLY_REASON },
    ])
  }

  it('queues a scan the server refused on push again once per grant that opens it', async () => {
    const scanId = await refusedOffTune()
    const slot = vi.spyOn(fake.api, 'requestScanUploadSlot')

    // Unknown, and free with the scan off the scan tune, both leave it waiting.
    await scanUploadPass(db, fake.api)
    await db.entitlements.put(entitlementRow())
    await scanUploadPass(db, fake.api)
    expect(await pendingFor(db, 'scans', scanId)).toBeUndefined()
    expect((await db.scan_files.get(scanId))?.error).toBe(SCAN_TUNE_ONLY_ERROR)

    await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
    await scanUploadPass(db, fake.api)
    // The server never stored the row, so it has to reach the server before a slot can.
    expect(slot).not.toHaveBeenCalled()
    expect(await pendingFor(db, 'scans', scanId)).toBeDefined()
    expect((await db.scan_files.get(scanId))?.error).toBeNull()

    // The server still refuses, as for a device that judges Premium before the server does.
    await refusedAgain(scanId)
    await scanUploadPass(db, fake.api)
    expect(await pendingFor(db, 'scans', scanId)).toBeUndefined()
    expect((await db.scan_files.get(scanId))?.error).toBe(SCAN_TUNE_ONLY_ERROR)

    await db.entitlements.put(
      entitlementRow({ premium_source: 'stripe', premium_expires_at: '2099-01-01T00:00:00.000Z' }),
    )
    await scanUploadPass(db, fake.api)
    expect(await pendingFor(db, 'scans', scanId)).toBeDefined()
    expect(slot).not.toHaveBeenCalled()
  })

  it('queues a refused scan again when the same grant returns after a free spell', async () => {
    const scanId = await refusedOffTune()
    await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
    await scanUploadPass(db, fake.api)
    await refusedAgain(scanId)

    await db.entitlements.put(entitlementRow())
    await scanUploadPass(db, fake.api)
    expect(await pendingFor(db, 'scans', scanId)).toBeUndefined()

    await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
    await scanUploadPass(db, fake.api)
    expect(await pendingFor(db, 'scans', scanId)).toBeDefined()
    expect((await db.scan_files.get(scanId))?.error).toBeNull()
  })

  it('queues a refused scan again on a free plan once no scan tune is left, once per scan tune', async () => {
    const scanId = await refusedOffTune()
    await db.entitlements.put(entitlementRow())
    await scanUploadPass(db, fake.api)
    expect(await pendingFor(db, 'scans', scanId)).toBeUndefined()

    await deleteScan(db, 'kept')
    await db.outbox.clear()
    await scanUploadPass(db, fake.api)
    expect(await pendingFor(db, 'scans', scanId)).toBeDefined()
    expect((await db.scan_files.get(scanId))?.error).toBeNull()

    // The server has not heard of the delete yet, so it still refuses.
    await refusedAgain(scanId)
    await scanUploadPass(db, fake.api)
    expect(await pendingFor(db, 'scans', scanId)).toBeUndefined()
    expect((await db.scan_files.get(scanId))?.error).toBe(SCAN_TUNE_ONLY_ERROR)

    // A new scan on the refused scan's own tune makes it the scan tune.
    const tuneId = (await db.scans.get(scanId))!.tune_id
    await addScans(db, tuneId, [
      { blob: new Blob([IMAGE], { type: 'image/jpeg' }), width: 800, height: 1200 },
    ])
    await db.outbox.clear()
    await scanUploadPass(db, fake.api)
    expect(await pendingFor(db, 'scans', scanId)).toBeDefined()
  })

  it('downloads only the scans on the scan tune while the plan is free', async () => {
    await db.entitlements.put(entitlementRow())
    await applyPullPage(
      db,
      [
        { table: 'tunes', row: serverTune({ id: 'tune-a' }) },
        { table: 'tunes', row: serverTune({ id: 'tune-b' }) },
        {
          table: 'scans',
          row: serverScan({ id: 'on', tune_id: 'tune-a', created_at: '2026-10-01T00:00:00Z' }),
        },
        {
          table: 'scans',
          row: serverScan({ id: 'off', tune_id: 'tune-b', created_at: '2026-10-02T00:00:00Z' }),
        },
      ],
      5,
    )
    for (const id of ['on', 'off']) {
      fake.scanStates.set(id, 'ready')
      fake.objects.set(`${id}/scan.jpg`, new Blob([IMAGE], { type: 'image/jpeg' }))
    }
    const url = vi.spyOn(fake.api, 'scanDownloadUrl')
    await scanDownloadPass(db, fake.api, createDownloadRetries())
    expect(url.mock.calls.map(([id]) => id)).toEqual(['on'])
    expect(await db.scan_files.get('on')).toMatchObject({ origin: 'downloaded' })
    expect(await db.scan_files.get('off')).toBeUndefined()
  })

  it('leaves a scan the server refused for its tune out of the scan tune it downloads for', async () => {
    await db.entitlements.put(entitlementRow())
    const { scanId } = await capturedScan()
    await db.scans.update(scanId, { created_at: '2026-09-01T00:00:00.000Z' })
    await db.scan_files.update(scanId, { error: SCAN_TUNE_ONLY_ERROR })
    await applyPullPage(
      db,
      [
        { table: 'tunes', row: serverTune({ id: 'tune-a' }) },
        {
          table: 'scans',
          row: serverScan({ id: 'on', tune_id: 'tune-a', created_at: '2026-10-01T00:00:00Z' }),
        },
      ],
      5,
    )
    fake.scanStates.set('on', 'ready')
    fake.objects.set('on/scan.jpg', new Blob([IMAGE], { type: 'image/jpeg' }))
    const url = vi.spyOn(fake.api, 'scanDownloadUrl')
    await scanDownloadPass(db, fake.api, createDownloadRetries())
    expect(url.mock.calls.map(([id]) => id)).toEqual(['on'])
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
