import type { Table } from 'dexie'
import type { ChangeResult, EventRow, PullRow } from '../api/types'
import { setEventsCursor, setPullCursor } from '../db/meta'
import { eventTables, rowsTable, syncTables, type CrosstuneDb } from '../db/schema'
import {
  isEventTable,
  isSyncTable,
  stripOwnership,
  type LocalRow,
  type OutboxEntry,
  type TableName,
} from '../db/types'

/** A push the server refused, so the local edit will never reach it. */
export interface InvalidChange {
  table: TableName
  id: string
  reason: string | null
}

export function compareTimestamps(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b)
}

export function toLocalRow(row: object): LocalRow {
  return stripOwnership(row) as LocalRow
}

/** The store a pushed row's result lands in: its synced table, its event store, or none
 * for a table this device does not store. */
function storeFor(db: CrosstuneDb, table: TableName): Table<object, string> | undefined {
  if (isSyncTable(table)) return rowsTable(db, table)
  return isEventTable(table) ? db[table] : undefined
}

function rowKey(table: string, id: string): string {
  return `${table}:${id}`
}

/** The whole outbox keyed by row. Call inside the transaction that acts on it. */
async function pendingByRow(db: CrosstuneDb): Promise<Map<string, OutboxEntry>> {
  const entries = await db.outbox.toArray()
  return new Map(entries.map((entry) => [rowKey(entry.table, entry.row_id), entry]))
}

export async function applyPushResults(
  db: CrosstuneDb,
  sent: OutboxEntry[],
  results: ChangeResult[],
): Promise<{ invalid: InvalidChange[]; settled: number }> {
  const invalid: InvalidChange[] = []
  let settled = 0
  const byKey = new Map(results.map((r) => [rowKey(r.table, r.id), r]))
  await db.transaction('rw', [...syncTables(db), ...eventTables(db), db.outbox], async () => {
    // A row keeps its seq when re-queued, so the sent seqs find each row's current entry.
    const pending = await db.outbox.bulkGet(sent.map((entry) => entry.seq!))
    const stores = new Map<TableName, object[]>()
    const settledSeqs: number[] = []
    const rejectedEvents = new Map<TableName, string[]>()
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
    for (const [table, rows] of stores) await storeFor(db, table)?.bulkPut(rows)
    for (const [table, ids] of rejectedEvents) await storeFor(db, table)?.bulkDelete(ids)
    await db.outbox.bulkDelete(settledSeqs)
  })
  return { invalid, settled }
}

export async function applyPullPage(
  db: CrosstuneDb,
  rows: PullRow[],
  nextSince: number,
): Promise<void> {
  await db.transaction('rw', [...syncTables(db), db.outbox, db.meta], async () => {
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
      if (isSyncTable(table)) await rowsTable(db, table).bulkPut(stored)
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
