import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from '../api/client'
import type { NotationPageRow } from '../api/types'
import { addNotationPages, deleteNotationPage } from '../commands/notation'
import { appendChunk, beginCapture, finishCapture } from '../commands/recordings'
import { createTune, deleteTune } from '../commands/tunes'
import { newId } from '../commands/write'
import { setStorage } from '../db/meta'
import { NOTATION_REFUSED_ERROR, NOTATION_STORAGE_FULL_ERROR } from '../db/notation'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { transfersSettled } from '../test/transfers'
import { createFakeApi, serverTune } from '../test/fakeApi'
import { applyPullPage } from './apply'
import { createSyncEngine } from './engine'
import {
  dropTombstonedPageFiles,
  notationDownloadPass,
  notationUploadPass,
} from './notationTransfers'
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

async function capturedPage(): Promise<{ tuneId: string; pageId: string }> {
  const { tuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
  const [pageId] = await addNotationPages(db, tuneId, [
    { blob: new Blob([IMAGE], { type: 'image/jpeg' }), width: 800, height: 1200 },
  ])
  return { tuneId, pageId: pageId! }
}

/** As if every queued row reached the server and was stored there. */
async function pushedEverything(): Promise<void> {
  await db.outbox.clear()
  await db.notation_pages.toCollection().modify({ server_seq: 1 })
}

function serverPage(overrides: Partial<NotationPageRow> & { id: string; tune_id: string }) {
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

async function readyOnServer(pageId: string, tuneId = newId()): Promise<void> {
  await applyPullPage(
    db,
    [
      { table: 'tunes', row: serverTune({ id: tuneId }) },
      { table: 'notation_pages', row: serverPage({ id: pageId, tune_id: tuneId }) },
    ],
    5,
  )
  fake.notationStates.set(pageId, 'ready')
  fake.objects.set(`${pageId}/page.jpg`, new Blob([IMAGE], { type: 'image/jpeg' }))
}

describe('notationUploadPass', () => {
  it('waits until the row has been pushed', async () => {
    const { pageId } = await capturedPage()
    const slot = vi.spyOn(fake.api, 'requestNotationUploadSlot')
    expect(await notationUploadPass(db, fake.api)).toBeNull()
    expect(slot).not.toHaveBeenCalled()
    expect(await db.notation_files.get(pageId)).toMatchObject({ origin: 'captured' })
  })

  it('uploads a captured page after its row is pushed', async () => {
    const { pageId } = await capturedPage()
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    await transfersSettled(engine)
    engine.stop()

    expect(await pendingFor(db, 'notation_pages', pageId)).toBeUndefined()
    expect(fake.notationSlots.get(pageId)).toEqual({
      bytes: IMAGE.length,
      content_type: 'image/jpeg',
    })
    expect(await fake.objects.get(`${pageId}/page.jpg`)?.text()).toBe(IMAGE)
    expect(fake.putTypes.get(`${pageId}/page.jpg`)).toBe('image/jpeg')
    expect(fake.notationStates.get(pageId)).toBe('ready')
    // The bytes are now what the server holds, so the file is a cache like any download.
    expect(await db.notation_files.get(pageId)).toMatchObject({
      origin: 'downloaded',
      error: null,
      upload_attempts: 0,
      next_attempt_at: null,
    })
  })

  it('marks storage full on a quota refusal', async () => {
    const { pageId } = await capturedPage()
    await pushedEverything()
    fake.failSlot(quotaRefusal())
    expect(await notationUploadPass(db, fake.api)).toBeNull()
    expect(await db.notation_files.get(pageId)).toMatchObject({
      origin: 'captured',
      error: NOTATION_STORAGE_FULL_ERROR,
      next_attempt_at: null,
    })
    expect(await (await db.notation_files.get(pageId))?.blob.text()).toBe(IMAGE)
  })

  it('does not retry a storage-full page until the storage figures show room', async () => {
    const { pageId } = await capturedPage()
    await pushedEverything()
    fake.failSlot(quotaRefusal())
    await notationUploadPass(db, fake.api)
    fake.failSlot(null)
    const slot = vi.spyOn(fake.api, 'requestNotationUploadSlot')

    await setStorage(db, { used_bytes: 99, quota_bytes: 100, max_file_bytes: 50 })
    await notationUploadPass(db, fake.api)
    expect(slot).not.toHaveBeenCalled()
    expect((await db.notation_files.get(pageId))?.error).toBe(NOTATION_STORAGE_FULL_ERROR)

    await setStorage(db, { used_bytes: 50, quota_bytes: 100, max_file_bytes: 50 })
    await notationUploadPass(db, fake.api)
    expect(await db.notation_files.get(pageId)).toMatchObject({ origin: 'downloaded', error: null })
  })

  it('settles a page the server already holds as downloaded on a slot conflict', async () => {
    const { pageId } = await capturedPage()
    await pushedEverything()
    fake.notationStates.set(pageId, 'ready')
    expect(await notationUploadPass(db, fake.api)).toBeNull()
    expect(await db.notation_files.get(pageId)).toMatchObject({ origin: 'downloaded' })
  })

  it('waits for the pull instead of queuing the row again after a remote delete', async () => {
    const { tuneId, pageId } = await capturedPage()
    await pushedEverything()
    fake.failSlot(new ApiError(404, null), pageId)
    expect(await notationUploadPass(db, fake.api)).toBeNull()
    expect(await pendingFor(db, 'notation_pages', pageId)).toBeUndefined()
    expect(await db.notation_files.get(pageId)).toMatchObject({
      origin: 'captured',
      upload_attempts: 1,
    })

    const deletedAt = '2026-10-03T21:00:00.000Z'
    await applyPullPage(
      db,
      [
        {
          table: 'notation_pages',
          row: serverPage({
            id: pageId,
            tune_id: tuneId,
            state: 'pending_upload',
            deleted_at: deletedAt,
            updated_at: deletedAt,
          }),
        },
      ],
      10,
    )
    await notationUploadPass(db, fake.api)
    expect(await db.notation_files.get(pageId)).toBeUndefined()
    expect(await pendingFor(db, 'notation_pages', pageId)).toBeUndefined()
  })

  it('stops retrying a page whose row the server refused on push', async () => {
    const { pageId } = await capturedPage()
    fake.respondToPush((changes) =>
      changes.map((c) => ({ table: c.table, id: c.id, status: 'invalid', reason: 'page limit' })),
    )
    fake.failSlot(new ApiError(404, null), pageId)
    const slot = vi.spyOn(fake.api, 'requestNotationUploadSlot')
    const engine = createSyncEngine({
      db,
      api: fake.api,
      isOnline: () => true,
      onInvalid: () => {},
    })
    await engine.sync()
    await transfersSettled(engine)
    engine.stop()
    expect(await pendingFor(db, 'notation_pages', pageId)).toBeUndefined()
    expect(slot).toHaveBeenCalledOnce()
    expect(await db.notation_files.get(pageId)).toMatchObject({
      origin: 'captured',
      error: NOTATION_REFUSED_ERROR,
      next_attempt_at: null,
    })

    await notationUploadPass(db, fake.api)
    expect(slot).toHaveBeenCalledOnce()
    expect(await db.outbox.count()).toBe(0)
  })

  it('uploads a refused page once a later push has stored its row', async () => {
    const { pageId } = await capturedPage()
    await pushedEverything()
    await db.notation_files.update(pageId, { error: NOTATION_REFUSED_ERROR })
    const slot = vi.spyOn(fake.api, 'requestNotationUploadSlot')
    await notationUploadPass(db, fake.api)
    expect(slot).toHaveBeenCalledOnce()
    expect(await db.notation_files.get(pageId)).toMatchObject({ origin: 'downloaded', error: null })
  })

  it('backs off a transient failure, keeps the reason, and holds it as the pass error', async () => {
    const { pageId } = await capturedPage()
    await pushedEverything()
    const failure = new ApiError(500, null)
    fake.failSlot(failure)
    const before = Date.now()
    expect(await notationUploadPass(db, fake.api)).toBe(failure)
    const file = await db.notation_files.get(pageId)
    expect(file).toMatchObject({ origin: 'captured', upload_attempts: 1, error: failure.message })
    expect(file?.next_attempt_at).toBeGreaterThanOrEqual(before + retryDelayMs(0))

    fake.failSlot(null)
    const slot = vi.spyOn(fake.api, 'requestNotationUploadSlot')
    await notationUploadPass(db, fake.api)
    expect(slot).not.toHaveBeenCalled()
  })

  it('sends a fresh slot next pass when confirmation reports a conflict', async () => {
    const { pageId } = await capturedPage()
    await pushedEverything()
    fake.failConfirm(new ApiError(409, null))
    expect(await notationUploadPass(db, fake.api)).toBeNull()
    expect(await db.notation_files.get(pageId)).toMatchObject({
      origin: 'captured',
      upload_attempts: 1,
    })
  })

  it('rethrows an auth failure instead of holding it', async () => {
    await capturedPage()
    await pushedEverything()
    const refused = new ApiError(401, null)
    fake.failSlot(refused)
    await expect(notationUploadPass(db, fake.api)).rejects.toBe(refused)
  })
})

describe('dropTombstonedPageFiles', () => {
  it('drops the file of a page whose tune was deleted elsewhere', async () => {
    const { tuneId, pageId } = await capturedPage()
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
          table: 'notation_pages',
          row: serverPage({
            id: pageId,
            tune_id: tuneId,
            state: 'pending_upload',
            deleted_at: deletedAt,
            updated_at: deletedAt,
          }),
        },
      ],
      10,
    )
    const slot = vi.spyOn(fake.api, 'requestNotationUploadSlot')
    await notationUploadPass(db, fake.api)
    expect(slot).not.toHaveBeenCalled()
    expect(await db.notation_files.get(pageId)).toBeUndefined()
  })

  it('drops the file of a refused page whose tune was deleted elsewhere', async () => {
    const { tuneId, pageId } = await capturedPage()
    await db.outbox.clear()
    await db.notation_files.update(pageId, { error: NOTATION_REFUSED_ERROR })
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
    await dropTombstonedPageFiles(db)
    expect(await db.notation_files.get(pageId)).toBeUndefined()
  })

  it('drops the file of a page whose tune is not on this device', async () => {
    const { tuneId, pageId } = await capturedPage()
    await db.tunes.delete(tuneId)
    await dropTombstonedPageFiles(db)
    expect(await db.notation_files.get(pageId)).toBeUndefined()
  })

  it('drops the file of a page deleted or whose tune was deleted on this device', async () => {
    const { tuneId, pageId } = await capturedPage()
    const [other] = await addNotationPages(db, tuneId, [
      { blob: new Blob(['x']), width: 1, height: 1 },
    ])
    await deleteNotationPage(db, other!)
    await dropTombstonedPageFiles(db)
    expect(await db.notation_files.get(other!)).toBeUndefined()
    expect(await db.notation_files.get(pageId)).toBeDefined()

    await deleteTune(db, tuneId)
    await dropTombstonedPageFiles(db)
    expect(await db.notation_files.get(pageId)).toBeUndefined()
  })
})

describe('notationDownloadPass', () => {
  it('downloads every ready page with keep offline off', async () => {
    await readyOnServer('p1')
    await readyOnServer('p2')
    await notationDownloadPass(db, fake.api, createDownloadRetries())
    for (const id of ['p1', 'p2']) {
      const file = await db.notation_files.get(id)
      expect(file).toMatchObject({ origin: 'downloaded', error: null })
      expect(await file?.blob.text()).toBe(IMAGE)
    }
  })

  it('skips a page that is waiting for upload or already has its file', async () => {
    const { pageId } = await capturedPage()
    await readyOnServer('p1')
    await notationDownloadPass(db, fake.api, createDownloadRetries())
    const url = vi.spyOn(fake.api, 'notationDownloadUrl')
    await notationDownloadPass(db, fake.api, createDownloadRetries())
    expect(url).not.toHaveBeenCalled()
    expect(await db.notation_files.get(pageId)).toMatchObject({ origin: 'captured' })
  })

  it('skips a ready page whose tune is deleted or not on this device', async () => {
    const tuneId = newId()
    await readyOnServer('p1', tuneId)
    await db.tunes.update(tuneId, { deleted_at: AT })
    await readyOnServer('p2')
    await db.tunes.delete((await db.notation_pages.get('p2'))!.tune_id)
    const url = vi.spyOn(fake.api, 'notationDownloadUrl')
    await notationDownloadPass(db, fake.api, createDownloadRetries())
    expect(url).not.toHaveBeenCalled()
    expect(await db.notation_files.count()).toBe(0)
  })

  it('waits out a failed download backoff before trying it again', async () => {
    await readyOnServer('p1')
    let now = 1_000_000
    const retries = createDownloadRetries(() => now)
    const url = vi.spyOn(fake.api, 'notationDownloadUrl').mockRejectedValueOnce(new Error('boom'))

    await notationDownloadPass(db, fake.api, retries)
    await notationDownloadPass(db, fake.api, retries)
    expect(url).toHaveBeenCalledTimes(1)

    now += retryDelayMs(0)
    await notationDownloadPass(db, fake.api, retries)
    expect(url).toHaveBeenCalledTimes(2)
    expect(await db.notation_files.get('p1')).toMatchObject({ origin: 'downloaded' })
  })

  it('stops the pass on a network failure', async () => {
    await readyOnServer('p1')
    const offline = new NetworkError(new TypeError('offline'))
    vi.spyOn(fake.api, 'notationDownloadUrl').mockRejectedValue(offline)
    await expect(notationDownloadPass(db, fake.api, createDownloadRetries())).rejects.toBe(offline)
  })

  it('stores nothing when the page is deleted while its download is in flight', async () => {
    await readyOnServer('p1')
    const getObject = fake.api.getObject
    vi.spyOn(fake.api, 'getObject').mockImplementation(async (url) => {
      await db.notation_pages.update('p1', { deleted_at: AT })
      return getObject(url)
    })
    await notationDownloadPass(db, fake.api, createDownloadRetries())
    expect(await db.notation_files.get('p1')).toBeUndefined()
  })
})

describe('engine transfers', () => {
  it('still uploads recordings when a page download fails offline, then reports it', async () => {
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
    vi.spyOn(fake.api, 'notationDownloadUrl').mockRejectedValue(
      new NetworkError(new TypeError('offline')),
    )
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    await transfersSettled(engine)
    engine.stop()
    expect(fake.recordingStates.get(recordingId)).toBe('uploaded')
    expect(engine.transferStatus()).toBe('error')
  })

  it('runs notation transfers before recording transfers', async () => {
    await capturedPage()
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
    const pageSlot = vi.spyOn(fake.api, 'requestNotationUploadSlot')
    const recordingSlot = vi.spyOn(fake.api, 'requestUploadSlot')
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    await transfersSettled(engine)
    engine.stop()
    expect(pageSlot).toHaveBeenCalledOnce()
    expect(recordingSlot).toHaveBeenCalledOnce()
    expect(pageSlot.mock.invocationCallOrder[0]).toBeLessThan(
      recordingSlot.mock.invocationCallOrder[0]!,
    )
  })
})
