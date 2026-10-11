import { ApiError, NetworkError } from '../api/client'
import { type Plan, scanOpens } from '../billing/plan'
import { readPlan } from '../billing/entitlement'
import { now, putRow, writeTx } from '../commands/write'
import type { SyncApi } from '../api/types'
import { getMeta, getStorage, META_SCAN_REQUEUES, setMeta } from '../db/meta'
import {
  SCAN_REFUSED_ERROR,
  SCAN_STORAGE_FULL_ERROR,
  SCAN_TUNE_ONLY_ERROR,
  readScanTune,
  type ScanFile,
  scansLive,
} from '../db/scans'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { isAuthFailure, isRetryableRefusal, SCAN_TUNE_ONLY_PROBLEM } from './errors'
import { type DownloadRetries, errorText, QUOTA_PROBLEM, retryDelayMs } from './transfers'

const SCAN_CONTENT_TYPE = 'image/jpeg'

type UploadFields = Pick<ScanFile, 'origin' | 'error'>

/** Leave the retry loop: clear the backoff and record where the file now stands. */
async function settleUpload(db: CrosstuneDb, id: string, fields: Partial<UploadFields>) {
  await db.scan_files.update(id, {
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
  const file = await db.scan_files.get(id)
  const attempts = file?.upload_attempts ?? 0
  await db.scan_files.update(id, {
    error: errorText(cause),
    upload_attempts: attempts + 1,
    next_attempt_at: Date.now() + retryDelayMs(attempts),
  })
}

async function uploadOne(db: CrosstuneDb, api: SyncApi, id: string): Promise<void> {
  const file = await db.scan_files.get(id)
  if (!file || file.origin !== 'captured') return
  const scan = await db.scans.get(id)
  // A tombstone that lands mid-pass is settled by the next pass's dropTombstonedScanFiles.
  if (!scan || scan.deleted_at) return
  // The row must exist on the server before it can be given a slot.
  if (await pendingFor(db, 'scans', id)) return
  if (scan.state !== 'pending_upload') {
    await settleUploaded(db, id)
    return
  }

  let slot
  try {
    slot = await api.requestScanUploadSlot(id, {
      bytes: file.blob.size,
      content_type: SCAN_CONTENT_TYPE,
    })
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.problemType === QUOTA_PROBLEM) {
        await settleUpload(db, id, { error: SCAN_STORAGE_FULL_ERROR })
        return
      }
      if (error.status === 403 && error.problemType === SCAN_TUNE_ONLY_PROBLEM) {
        await settleUpload(db, id, { error: SCAN_TUNE_ONLY_ERROR })
        return
      }
      if (error.status === 409) {
        // The scan is past pending on the server, so a previous confirmation landed.
        await settleUploaded(db, id)
        return
      }
      if (error.status === 404) {
        // A scan row the server never stored was refused on push and can never be given a
        // slot. One it did store has since been deleted there, with it or its tune; pushing
        // it again would win over that tombstone, so wait for the pull to bring it instead.
        if (scan.server_seq === 0) {
          await settleUpload(db, id, { error: SCAN_REFUSED_ERROR })
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
    await api.putObject(slot.url, file.blob, SCAN_CONTENT_TYPE)
    await api.scanUploadFinished(id)
    await settleUploaded(db, id)
  } catch (error) {
    await scheduleRetry(db, id, error)
    // A confirmation conflict means the slot expired or the object never landed; the
    // next pass asks for a fresh slot, and nothing about the transfer itself failed.
    if (error instanceof ApiError && error.status === 409) return
    throw error
  }
}

interface ScanRequeues {
  /** What the refused scans were queued again under: a Premium grant or a free scan tune. */
  basis: string
  ids: string[]
}

/** The basis a refused row may be queued again under on this pass, or null when it must wait:
 * any scan under a Premium grant, and on a free plan a scan on the scan tune, or any scan while
 * there is none, since the server refuses only scans off it. */
function requeueBasis(plan: Plan, tuneId: string, scanTune: string | null): string | null {
  if (plan.kind === 'premium') {
    return `premium ${plan.source ?? 'none'} ${plan.premiumEndsAt?.toISOString() ?? 'never'}`
  }
  if (plan.kind === 'free' && (scanTune === null || scanTune === tuneId)) {
    return `tune ${scanTune ?? 'none'}`
  }
  return null
}

/**
 * Record one more chance for a refused scan under `basis`, or return false when it has had one.
 * Once per scan per basis: the device may judge Premium inside the offline leeway, or a scan tune
 * the server does not share yet, while the server still refuses, and would otherwise resend the
 * scan every sync. Callers run it inside a transaction that includes `meta`.
 */
async function claimRequeue(db: CrosstuneDb, id: string, basis: string): Promise<boolean> {
  const stored = await getMeta<ScanRequeues | null>(db, META_SCAN_REQUEUES, null)
  const requeues = stored?.basis === basis ? stored : { basis, ids: [] }
  if (requeues.ids.includes(id)) return false
  await setMeta(db, META_SCAN_REQUEUES, { basis, ids: [...requeues.ids, id] })
  return true
}

/** Queue a live scan row the server refused for its tune once more and clear its file's refusal,
 * so the next push stores it and the upload after can take a slot. Once per basis. */
async function requeueRefusedScan(db: CrosstuneDb, id: string, basis: string): Promise<void> {
  await writeTx(db, async () => {
    const scan = await db.scans.get(id)
    if (!scan || scan.deleted_at || scan.server_seq !== 0) return
    if (!(await claimRequeue(db, id, basis))) return
    if (!(await pendingFor(db, 'scans', id))) {
      await putRow(db, 'scans', { ...scan, updated_at: now() })
    }
    await db.scan_files.update(id, { error: null })
  }, [db.meta, db.scan_files])
}

/** Forget the scans queued again under a Premium grant once the plan is not Premium, so the
 * same grant returning, as a comp that never expires does, is a new chance. */
async function endPremiumRequeues(db: CrosstuneDb, plan: Plan): Promise<void> {
  if (plan.kind === 'premium') return
  await db.transaction('rw', db.meta, async () => {
    const stored = await getMeta<ScanRequeues | null>(db, META_SCAN_REQUEUES, null)
    if (stored?.basis.startsWith('premium ')) await db.meta.delete(META_SCAN_REQUEUES)
  })
}

/** Remove every scan file whose scan, or its tune, was deleted here or elsewhere, or is not here.
 * A captured file goes too: a deleted scan has no tune to come back to, unlike an unfiled
 * recording. */
export async function dropTombstonedScanFiles(db: CrosstuneDb): Promise<void> {
  await db.transaction('rw', db.tunes, db.scans, db.scan_files, async () => {
    // Keys only: a file row carries its image.
    const ids = await db.scan_files.toCollection().primaryKeys()
    const live = await scansLive(db, await db.scans.bulkGet(ids))
    await db.scan_files.bulkDelete(ids.filter((_, i) => !live[i]))
  })
}

/**
 * Upload every captured scan whose row has reached the server. A row's own transient failure
 * does not stop the rest of the pass; the first one is returned (null when every row settled)
 * so the caller can still fail the transfer run. Only an auth failure is thrown.
 */
export async function scanUploadPass(db: CrosstuneDb, api: SyncApi): Promise<unknown> {
  await dropTombstonedScanFiles(db)

  const waiting = await db.scan_files.where('origin').equals('captured').toArray()
  const storage = await getStorage(db)
  const plan = await readPlan(db, new Date())
  await endPremiumRequeues(db, plan)
  const refusedOffTune = waiting.some((file) => file.error === SCAN_TUNE_ONLY_ERROR)
  const scanTune = refusedOffTune && plan.kind === 'free' ? await readScanTune(db) : null
  const nowMs = Date.now()
  let firstError: unknown = null
  for (const file of waiting) {
    if (file.error === SCAN_TUNE_ONLY_ERROR) {
      const scan = await db.scans.get(file.id)
      if (!scan) continue
      const basis = requeueBasis(plan, scan.tune_id, scanTune)
      // A row the server refused on push was never stored there, so it goes back out before
      // its upload can be given a slot.
      if (scan.server_seq === 0) {
        if (basis !== null) await requeueRefusedScan(db, file.id, basis)
        continue
      }
      // A stored row whose slot was refused asks again on a free plan once per basis, since the
      // device's scan tune can open it before the server's does.
      if (plan.kind === 'free') {
        if (basis === null) continue
        const claimed = await db.transaction('rw', db.meta, () => claimRequeue(db, file.id, basis))
        if (!claimed) continue
      }
    }
    // Only the storage figures a sync refreshes free a refused scan; asking for a slot
    // before they show room would draw the same refusal.
    if (
      file.error === SCAN_STORAGE_FULL_ERROR &&
      storage &&
      storage.used_bytes + file.blob.size > storage.quota_bytes
    ) {
      continue
    }
    if (file.error === SCAN_REFUSED_ERROR) {
      // A refused row the server has since stored, as after a later edit's push, can take a
      // slot after all.
      const scan = await db.scans.get(file.id)
      if (!scan || scan.server_seq === 0) continue
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

/** Store a fetched image only while its scan and tune are live and it has no file yet: a delete or
 * a capture that landed during the fetch wins over it. */
async function storeDownloaded(db: CrosstuneDb, id: string, blob: Blob): Promise<void> {
  await db.transaction('rw', db.tunes, db.scans, db.scan_files, async () => {
    const [live] = await scansLive(db, [await db.scans.get(id)])
    if (!live) return
    if (await db.scan_files.get(id)) return
    await db.scan_files.put({
      id,
      blob,
      origin: 'downloaded',
      error: null,
      next_attempt_at: null,
      upload_attempts: 0,
    })
  })
}

/** Fetch every ready scan with no local file. Scans always download, whatever keep offline says,
 * because a scan is small and the reading view has to work with no signal. */
export async function scanDownloadPass(
  db: CrosstuneDb,
  api: SyncApi,
  retries: DownloadRetries,
): Promise<void> {
  const readyScans = await db.scans.where('state').equals('ready').toArray()
  const live = await scansLive(db, readyScans)
  const plan = await readPlan(db, new Date())
  const scanTune = plan.kind === 'free' ? await readScanTune(db) : null
  // A scan whose file the next pass would drop, or that the plan keeps closed, is not worth
  // fetching.
  const ready = readyScans
    .filter((scan, i) => live[i] && scanOpens(plan, scan.tune_id, scanTune))
    .map((scan) => scan.id)
  const held = new Set(await db.scan_files.where(':id').anyOf(ready).primaryKeys())
  for (const id of ready) {
    if (held.has(id) || retries.isWaiting(id)) continue
    try {
      const signed = await api.scanDownloadUrl(id)
      await storeDownloaded(db, id, await api.getObject(signed.url))
      retries.succeeded(id)
    } catch (error) {
      // Offline and auth failures stop the whole pass; anything else is this scan's alone.
      if (error instanceof NetworkError || isAuthFailure(error)) throw error
      retries.failed(id)
    }
  }
}
