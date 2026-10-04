import { ApiError, NetworkError } from '../api/client'
import type { SyncApi } from '../api/types'
import { getStorage } from '../db/meta'
import {
  NOTATION_REFUSED_ERROR,
  NOTATION_STORAGE_FULL_ERROR,
  type NotationFile,
  pagesLive,
} from '../db/notation'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { isAuthFailure } from './errors'
import {
  type DownloadRetries,
  errorText,
  isRetryableRefusal,
  QUOTA_PROBLEM,
  retryDelayMs,
} from './transfers'

const PAGE_CONTENT_TYPE = 'image/jpeg'

type UploadFields = Pick<NotationFile, 'origin' | 'error'>

/** Leave the retry loop: clear the backoff and record where the file now stands. */
async function settleUpload(db: CrosstuneDb, id: string, fields: Partial<UploadFields>) {
  await db.notation_files.update(id, {
    error: null,
    ...fields,
    upload_attempts: 0,
    next_attempt_at: null,
  })
}

/** The server holds these bytes now, so the local file is a cache like any download. */
function settleUploaded(db: CrosstuneDb, id: string): Promise<void> {
  return settleUpload(db, id, { origin: 'downloaded' })
}

/** Back off a failed attempt, doubling with each consecutive miss, and keep the reason. */
async function scheduleRetry(db: CrosstuneDb, id: string, cause: unknown): Promise<void> {
  const file = await db.notation_files.get(id)
  const attempts = file?.upload_attempts ?? 0
  await db.notation_files.update(id, {
    error: errorText(cause),
    upload_attempts: attempts + 1,
    next_attempt_at: Date.now() + retryDelayMs(attempts),
  })
}

async function uploadOne(db: CrosstuneDb, api: SyncApi, id: string): Promise<void> {
  const file = await db.notation_files.get(id)
  if (!file || file.origin !== 'captured') return
  const page = await db.notation_pages.get(id)
  // A tombstone that lands mid-pass is settled by the next pass's dropTombstonedPageFiles.
  if (!page || page.deleted_at) return
  // The row must exist on the server before it can be given a slot.
  if (await pendingFor(db, 'notation_pages', id)) return
  if (page.state !== 'pending_upload') {
    await settleUploaded(db, id)
    return
  }

  let slot
  try {
    slot = await api.requestNotationUploadSlot(id, {
      bytes: file.blob.size,
      content_type: PAGE_CONTENT_TYPE,
    })
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.problemType === QUOTA_PROBLEM) {
        await settleUpload(db, id, { error: NOTATION_STORAGE_FULL_ERROR })
        return
      }
      if (error.status === 409) {
        // The page is past pending on the server, so a previous confirmation landed.
        await settleUploaded(db, id)
        return
      }
      if (error.status === 404) {
        // A page row the server never stored was refused on push and can never be given a
        // slot. One it did store has since been deleted there, with it or its tune; pushing
        // it again would win over that tombstone, so wait for the pull to bring it instead.
        if (page.server_seq === 0) {
          await settleUpload(db, id, { error: NOTATION_REFUSED_ERROR })
        } else {
          await scheduleRetry(db, id, error)
        }
        return
      }
      if (!isRetryableRefusal(error)) {
        // This file will not get a different answer soon; wait the backoff without
        // failing the pass, so the rest of the queue and the recordings still move.
        await scheduleRetry(db, id, error)
        return
      }
    }
    await scheduleRetry(db, id, error)
    throw error
  }

  try {
    await api.putObject(slot.url, file.blob, PAGE_CONTENT_TYPE)
    await api.notationUploadFinished(id)
    await settleUploaded(db, id)
  } catch (error) {
    await scheduleRetry(db, id, error)
    // A confirmation conflict means the slot expired or the object never landed; the
    // next pass asks for a fresh slot, and nothing about the transfer itself failed.
    if (error instanceof ApiError && error.status === 409) return
    throw error
  }
}

/** Remove every page file whose page, or its tune, was deleted here or elsewhere, or is not here.
 * A captured file goes too: a deleted page has no tune to come back to, unlike an unfiled
 * recording. */
export async function dropTombstonedPageFiles(db: CrosstuneDb): Promise<void> {
  await db.transaction('rw', db.tunes, db.notation_pages, db.notation_files, async () => {
    // Keys only: a file row carries its image.
    const ids = await db.notation_files.toCollection().primaryKeys()
    const live = await pagesLive(db, await db.notation_pages.bulkGet(ids))
    await db.notation_files.bulkDelete(ids.filter((_, i) => !live[i]))
  })
}

/**
 * Upload every captured page whose row has reached the server. A row's own transient failure
 * does not stop the rest of the pass; the first one is returned (null when every row settled)
 * so the caller can still fail the transfer run. Only an auth failure is thrown.
 */
export async function notationUploadPass(db: CrosstuneDb, api: SyncApi): Promise<unknown> {
  await dropTombstonedPageFiles(db)

  const waiting = await db.notation_files.where('origin').equals('captured').toArray()
  const storage = await getStorage(db)
  const nowMs = Date.now()
  let firstError: unknown = null
  for (const file of waiting) {
    // Only the storage figures a sync refreshes free a refused page; asking for a slot
    // before they show room would draw the same refusal.
    if (
      file.error === NOTATION_STORAGE_FULL_ERROR &&
      storage &&
      storage.used_bytes + file.blob.size > storage.quota_bytes
    ) {
      continue
    }
    if (file.error === NOTATION_REFUSED_ERROR) {
      // A refused row the server has since stored, as after a later edit's push, can take a
      // slot after all.
      const page = await db.notation_pages.get(file.id)
      if (!page || page.server_seq === 0) continue
    }
    if (file.next_attempt_at !== null && file.next_attempt_at > nowMs) continue
    try {
      await uploadOne(db, api, file.id)
    } catch (error) {
      if (isAuthFailure(error)) throw error
      firstError ??= error
    }
  }
  return firstError
}

/** Store a fetched image only while its page and tune are live and it has no file yet: a delete or
 * a capture that landed during the fetch wins over it. */
async function storeDownloaded(db: CrosstuneDb, id: string, blob: Blob): Promise<void> {
  await db.transaction('rw', db.tunes, db.notation_pages, db.notation_files, async () => {
    const [live] = await pagesLive(db, [await db.notation_pages.get(id)])
    if (!live) return
    if (await db.notation_files.get(id)) return
    await db.notation_files.put({
      id,
      blob,
      origin: 'downloaded',
      error: null,
      next_attempt_at: null,
      upload_attempts: 0,
    })
  })
}

/** Fetch every ready page with no local file. Pages always download, whatever keep offline says,
 * because a page is small and the reading view has to work with no signal. */
export async function notationDownloadPass(
  db: CrosstuneDb,
  api: SyncApi,
  retries: DownloadRetries,
): Promise<void> {
  const readyPages = await db.notation_pages.where('state').equals('ready').toArray()
  const live = await pagesLive(db, readyPages)
  // A page whose file the next pass would drop is not worth fetching.
  const ready = readyPages.filter((_, i) => live[i]).map((page) => page.id)
  const held = new Set(await db.notation_files.where(':id').anyOf(ready).primaryKeys())
  for (const id of ready) {
    if (held.has(id) || retries.isWaiting(id)) continue
    try {
      const signed = await api.notationDownloadUrl(id)
      await storeDownloaded(db, id, await api.getObject(signed.url))
      retries.succeeded(id)
    } catch (error) {
      // Offline and auth failures stop the whole pass; anything else is this page's alone.
      if (error instanceof NetworkError || isAuthFailure(error)) throw error
      retries.failed(id)
    }
  }
}
