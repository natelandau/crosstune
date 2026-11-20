import Dexie, { type Table } from 'dexie'
import { API_ORIGIN } from '../config'
import { DATABASE_NAME_PREFIX } from '../db/names'
import {
  HANDOFF_TAKE_BACK_ATTEMPTS,
  modifyWhileHeld,
  type HandedOffFile,
  type RecordingFile,
} from '../db/recordings'
import { isRetryableStatus } from '../sync/retryableStatus'

export interface HandoffDeps {
  fetch: typeof fetch
  now: () => number
  /** Names of every user database on this origin. */
  databaseNames: () => Promise<string[]>
}

type Files = Table<RecordingFile, string>

/** How one hand-off ended: settled for good, or failed and worth another run. */
type Outcome = 'settled' | 'retry'

/** The user databases this origin holds, by name. */
export async function userDatabaseNames(factory: IDBFactory): Promise<string[]> {
  const infos = await factory.databases()
  return infos.flatMap(({ name }) => (name?.startsWith(DATABASE_NAME_PREFIX) ? [name] : []))
}

/** Resolves when every live hand-off settled; rejects when one must be retried. */
export async function runUploadHandoffs(deps: HandoffDeps): Promise<void> {
  let retry = false
  for (const name of await deps.databaseNames()) {
    // A failure in one database, such as a close for the page's upgrade, leaves the others to run.
    const outcome = await runDatabase(name, deps).catch((error: unknown) => {
      console.warn(`Recording uploads in ${name} will be retried`, error)
      return 'retry' as const
    })
    if (outcome === 'retry') retry = true
  }
  if (retry) throw new Error('A recording upload will be retried')
}

/** The open database, or null when none has that name. */
async function openOrNull(name: string): Promise<Dexie | null> {
  // Dynamic mode: no declared version, so a worker a release behind the page opens any
  // version the page wrote, and a missing database is not created.
  const db = new Dexie(name)
  try {
    await db.open()
    return db
  } catch (error) {
    db.close()
    if (error instanceof Dexie.NoSuchDatabaseError) return null
    throw error
  }
}

async function runDatabase(name: string, deps: HandoffDeps): Promise<Outcome> {
  const db = await openOrNull(name)
  if (!db) return 'settled'
  try {
    if (!db.tables.some((table) => table.name === 'recording_files')) return 'settled'
    const files: Files = db.table('recording_files')
    const handedOff = (await files.where('local_state').equals('uploading').toArray()).filter(
      (file): file is HandedOffFile => file.handoff != null,
    )
    let outcome: Outcome = 'settled'
    for (const file of handedOff) {
      if ((await runHandoff(files, file, deps)) === 'retry') outcome = 'retry'
    }
    return outcome
  } finally {
    db.close()
  }
}

async function runHandoff(files: Files, file: HandedOffFile, deps: HandoffDeps): Promise<Outcome> {
  const { handoff } = file
  const write = (change: (row: RecordingFile) => void) =>
    modifyWhileHeld(files, file.id, handoff, change)
  const retry = async (error: unknown): Promise<Outcome> => {
    console.warn(`The upload of recording ${file.id} will be retried`, error)
    await write((row) => {
      if (row.handoff) row.handoff.attempts += 1
    })
    return 'retry'
  }
  if (handoff.expires_at <= deps.now() || !file.blob) {
    // Nothing here can be sent, so the page's next pass starts the file over with a new slot.
    await write((row) => {
      row.local_state = 'captured'
      row.handoff = null
    })
    return 'settled'
  }
  // The page takes these back on its next pass, so sending the bytes again only repeats a
  // refusal or races the page's own upload.
  if (handoff.refused || handoff.attempts >= HANDOFF_TAKE_BACK_ATTEMPTS) return 'settled'
  try {
    // A blob read back from IndexedDB is file-backed on iOS, which the network layer cannot
    // send, so the bytes go from memory.
    const body = await file.blob.arrayBuffer()
    const put = await deps.fetch(handoff.url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': handoff.content_type },
    })
    if (!put.ok) return await retry(new Error(`Upload answered ${put.status}`))
    // No body: the API checks a bearer token on any request that declares one.
    const confirm = await deps.fetch(
      `${API_ORIGIN}/v1/recordings/${encodeURIComponent(file.id)}/uploaded-with-token`,
      { method: 'POST', headers: { 'X-Upload-Token': handoff.confirm_token } },
    )
    if (!confirm.ok && isRetryableStatus(confirm.status)) {
      return await retry(new Error(`Confirm answered ${confirm.status}`))
    }
    if (!confirm.ok) {
      // The page takes the file back on its next pass and applies its own backoff and failure
      // rules to a refused or lost slot.
      await write((row) => {
        if (row.handoff) row.handoff.refused = true
      })
      return 'settled'
    }
    await write((row) => {
      row.local_state = 'uploaded'
      row.handoff = null
      row.error = null
      row.upload_attempts = 0
      row.next_attempt_at = null
    })
    return 'settled'
  } catch (error) {
    return retry(error)
  }
}
