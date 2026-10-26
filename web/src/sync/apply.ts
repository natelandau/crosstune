import type { Table } from 'dexie'
import type { ChangeResult, EventRow, PullRow } from '../api/types'
import {
  getLocalOnlyRows,
  keepLocalUntilSubscribed,
  releaseLocalOnlyRows,
  setEventsCursor,
  setPullCursor,
} from '../db/meta'
import { dependentRecordingId } from '../db/outbox'
import { eventTables, rowsTable, syncTables, type CrosstuneDb } from '../db/schema'
import {
  isEventTable,
  isPremiumTable,
  isSyncTable,
  stripOwnership,
  type LocalRow,
  type OutboxEntry,
  type StoredTableName,
  type TableName,
} from '../db/types'
import { MISSING_RECORDING_REASON, PREMIUM_REQUIRED_REASON } from './errors'

/** A push the server refused, so the local edit will never reach it. */
export interface InvalidChange {
  table: TableName
  id: string
  reason: string | null
}

export function compareTimestamps(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b)
}

function toLocalRow(row: object): LocalRow {
  return stripOwnership(row) as LocalRow
}

/** The store a row of the given table lands in. */
function storeFor(db: CrosstuneDb, table: StoredTableName): Table<object, string> {
  if (table === 'entitlements') return db.entitlements
  return isSyncTable(table) ? rowsTable(db, table) : db[table]
}

function rowKey(table: string, id: string): string {
  return `${table}:${id}`
}

/** The whole outbox keyed by row. Call inside the transaction that acts on it. */
async function pendingByRow(db: CrosstuneDb): Promise<Map<string, OutboxEntry>> {
  const entries = await db.outbox.toArray()
  return new Map(entries.map((entry) => [rowKey(entry.table, entry.row_id), entry]))
}

/** A recording's or scan's upsert the server refused for Premium waits in the outbox; every
 * other result settles its entry. */
function isLocalUntilSubscribed(entry: OutboxEntry, result: ChangeResult): boolean {
  return (
    result.status === 'invalid' &&
    result.reason === PREMIUM_REQUIRED_REASON &&
    isPremiumTable(entry.table) &&
    entry.op !== 'delete'
  )
}

/** The recording a refused row waits on: one that names a recording the server lacks. */
function awaitedRecording(entry: OutboxEntry, result: ChangeResult): string | null {
  if (result.status !== 'invalid' || result.reason !== MISSING_RECORDING_REASON) return null
  return dependentRecordingId(entry)
}

/**
 * Store what the server answered for a sent batch. `keptLocal` lists the recordings and scans
 * it refused for Premium: their entries stay queued and uncounted, since the device can judge
 * Premium before the server's grant agrees and the change is not lost. A row refused because its
 * recording is kept local stays queued the same way, to go out with it, and its recording is
 * listed in `keptLocal` too.
 */
export async function applyPushResults(
  db: CrosstuneDb,
  sent: OutboxEntry[],
  results: ChangeResult[],
): Promise<{ invalid: InvalidChange[]; settled: number; keptLocal: string[] }> {
  const invalid: InvalidChange[] = []
  const keptLocal: string[] = []
  let settled = 0
  const byKey = new Map(results.map((r) => [rowKey(r.table, r.id), r]))
  const tables = [...syncTables(db), ...eventTables(db), db.outbox, db.meta]
  await db.transaction('rw', tables, async () => {
    // A row keeps its seq when re-queued, so the sent seqs find each row's current entry.
    const pending = await db.outbox.bulkGet(sent.map((entry) => entry.seq!))
    const stores = new Map<TableName, object[]>()
    const settledSeqs: number[] = []
    const rejectedEvents = new Map<TableName, string[]>()
    const released: string[] = []
    const waiting: { entry: OutboxEntry; result: ChangeResult; recordingId: string }[] = []

    function settle(entry: OutboxEntry, result: ChangeResult) {
      if (result.status === 'invalid') {
        if (isEventTable(entry.table)) {
          // A refused event is not stored for this user, so its local copy would only ever
          // count on this device. No edit of the musician's was lost, so it is not reported.
          const ids = rejectedEvents.get(entry.table) ?? []
          ids.push(entry.row_id)
          rejectedEvents.set(entry.table, ids)
        } else if (entry.op !== 'delete') {
          // The server refuses a delete only for a row it never stored, which is what a row
          // created and deleted between pushes looks like: nothing was lost on either side.
          invalid.push({ table: entry.table, id: entry.row_id, reason: result.reason ?? null })
        }
      } else if (result.row) {
        const rows = stores.get(entry.table) ?? []
        rows.push(stripOwnership(result.row))
        stores.set(entry.table, rows)
      }
      settledSeqs.push(entry.seq!)
      settled++
    }

    for (const [i, entry] of sent.entries()) {
      const result = byKey.get(rowKey(entry.table, entry.row_id))
      if (!result) continue
      const current = pending[i]
      // A write queued after the batch left keeps its entry; the next push settles it.
      const unchanged =
        current !== undefined &&
        current.seq === entry.seq &&
        current.updated_at === entry.updated_at
      if (!unchanged) continue
      if (isLocalUntilSubscribed(entry, result)) {
        keptLocal.push(entry.row_id)
        continue
      }
      const recordingId = awaitedRecording(entry, result)
      if (recordingId !== null) {
        // Judged once the whole batch is read, since its recording's result may come later.
        waiting.push({ entry, result, recordingId })
        continue
      }
      if (isPremiumTable(entry.table)) released.push(entry.row_id)
      settle(entry, result)
    }

    const localOnly = await getLocalOnlyRows(db)
    for (const id of keptLocal) localOnly.add(id)
    for (const id of released) localOnly.delete(id)
    const keptFor = new Set<string>()
    for (const { entry, result, recordingId } of waiting) {
      if (localOnly.has(recordingId)) keptFor.add(recordingId)
      else settle(entry, result)
    }

    for (const [table, rows] of stores) await storeFor(db, table).bulkPut(rows)
    for (const [table, ids] of rejectedEvents) await storeFor(db, table).bulkDelete(ids)
    await db.outbox.bulkDelete(settledSeqs)
    await keepLocalUntilSubscribed(db, keptLocal)
    await releaseLocalOnlyRows(db, released)
    for (const id of keptFor) if (!keptLocal.includes(id)) keptLocal.push(id)
  })
  return { invalid, settled, keptLocal }
}

export async function applyPullPage(
  db: CrosstuneDb,
  rows: PullRow[],
  nextSince: number,
): Promise<void> {
  await db.transaction('rw', [...syncTables(db), db.entitlements, db.outbox, db.meta], async () => {
    const pending = await pendingByRow(db)
    const stores = new Map<TableName, LocalRow[]>()
    const supersededSeqs: number[] = []
    for (const pulled of rows) {
      const row = toLocalRow(pulled.row)
      const key = rowKey(pulled.table, row.id)
      const entry = pending.get(key)
      if (entry && compareTimestamps(entry.updated_at, row.updated_at) > 0) continue
      const stored = stores.get(pulled.table) ?? []
      stored.push(row)
      stores.set(pulled.table, stored)
      if (entry?.seq !== undefined) {
        supersededSeqs.push(entry.seq)
        pending.delete(key)
      }
    }
    for (const [table, stored] of stores) {
      // A table from a newer server has no store here; skipping it keeps the cursor moving.
      if (isSyncTable(table) || table === 'entitlements') await storeFor(db, table).bulkPut(stored)
    }
    await db.outbox.bulkDelete(supersededSeqs)
    await setPullCursor(db, nextSince)
  })
}

/** Store one events page and advance the events cursor past it, together. */
export async function applyEventsPage(
  db: CrosstuneDb,
  rows: EventRow[],
  nextSince: number,
): Promise<void> {
  const stores = eventTables(db)
  await db.transaction('rw', [...stores, db.meta], async () => {
    const known = new Set(stores.map((store) => store.name))
    const pages = new Map<string, object[]>()
    for (const pulled of rows) {
      // A table from a newer server has no store here; skipping it keeps the cursor moving.
      if (!known.has(pulled.table)) continue
      const stored = pages.get(pulled.table) ?? []
      stored.push(stripOwnership(pulled.row))
      pages.set(pulled.table, stored)
    }
    for (const [table, stored] of pages) await db.table(table).bulkPut(stored)
    await setEventsCursor(db, nextSince)
  })
}
