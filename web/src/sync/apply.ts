import type { ChangeResult, PullRow } from '../api/types'
import { setPullCursor } from '../db/meta'
import { rowsTable, syncTables, type CrosstuneDb } from '../db/schema'
import { stripOwnership, type LocalRow, type OutboxEntry, type TableName } from '../db/types'

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
  await db.transaction('rw', [...syncTables(db), db.outbox], async () => {
    const pending = await pendingByRow(db)
    const stores = new Map<TableName, LocalRow[]>()
    const settledSeqs: number[] = []
    for (const entry of sent) {
      const result = byKey.get(rowKey(entry.table, entry.row_id))
      if (!result) continue
      const current = pending.get(rowKey(entry.table, entry.row_id))
      // A write queued after the batch left keeps its entry; the next push settles it.
      const unchanged =
        current !== undefined &&
        current.seq === entry.seq &&
        current.updated_at === entry.updated_at
      if (!unchanged) continue
      if (result.status === 'invalid') {
        // The server refuses a delete only for a row it never stored, which is what a row
        // created and deleted between pushes looks like: nothing was lost on either side.
        if (entry.op !== 'delete') {
          invalid.push({ table: entry.table, id: entry.row_id, reason: result.reason ?? null })
        }
      } else if (result.row) {
        const rows = stores.get(entry.table) ?? []
        rows.push(toLocalRow(result.row))
        stores.set(entry.table, rows)
      }
      settledSeqs.push(entry.seq!)
      settled++
    }
    for (const [table, rows] of stores) await rowsTable(db, table).bulkPut(rows)
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
    for (const [table, stored] of stores) await rowsTable(db, table).bulkPut(stored)
    await db.outbox.bulkDelete(supersededSeqs)
    await setPullCursor(db, nextSince)
  })
}
