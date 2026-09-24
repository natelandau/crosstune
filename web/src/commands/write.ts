import { v7 as uuidv7 } from 'uuid'
import { dropPending, enqueue } from '../db/outbox'
import { rowsTable, syncTables, type CrosstuneDb } from '../db/schema'
import { toChangeData, type LocalRows, type TableName } from '../db/types'

export function now(): string {
  return new Date().toISOString()
}

export function newId(): string {
  return uuidv7()
}

/** Drop undefined keys so a partial patch never blanks a field. */
export function defined<T extends object>(patch: Partial<T>): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

export function writeTx<T>(db: CrosstuneDb, fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [...syncTables(db), db.outbox], fn)
}

/** A write that touches the local audio tables as well as the synced ones. */
export function recordingTx<T>(db: CrosstuneDb, fn: () => Promise<T>): Promise<T> {
  return db.transaction(
    'rw',
    [...syncTables(db), db.outbox, db.recording_files, db.recording_chunks],
    fn,
  )
}

/** Rows that have not been tombstoned, in position order. */
export function activeByPosition<T extends { deleted_at: string | null; position: number }>(
  rows: T[],
): T[] {
  return rows.filter((row) => !row.deleted_at).sort((a, b) => a.position - b.position)
}

/** One past the highest position among the given rows. */
export function nextPosition(rows: { position: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.position + 1), 0)
}

/**
 * The timestamp for a write to a row last stamped `stored`: `requested`, or one millisecond
 * past `stored` when that is not earlier. Both the push guard and the server's strictly-newer
 * rule tell two writes to one row apart only by updated_at, so a tie would drop the second.
 */
export function nextUpdatedAt(stored: string | undefined, requested: string): string {
  if (stored === undefined) return requested
  const floor = Date.parse(stored) + 1
  return Date.parse(requested) >= floor ? requested : new Date(floor).toISOString()
}

/** Store a row and queue its upsert. Call inside writeTx. */
export async function putRow<T extends TableName>(
  db: CrosstuneDb,
  table: T,
  row: LocalRows[T],
): Promise<void> {
  const rows = rowsTable(db, table)
  const stored = await rows.get(row.id)
  const stamped = { ...row, updated_at: nextUpdatedAt(stored?.updated_at, row.updated_at) }
  await rows.put(stamped)
  await enqueue(db, {
    table,
    row_id: row.id,
    op: 'upsert',
    updated_at: stamped.updated_at,
    data: toChangeData(stamped),
  })
}

/** Soft-delete a row. Dependents of a cascading parent pass enqueueDelete: false. */
export async function tombstone<T extends TableName>(
  db: CrosstuneDb,
  table: T,
  id: string,
  at: string,
  { enqueueDelete = true }: { enqueueDelete?: boolean } = {},
): Promise<void> {
  const rows = rowsTable(db, table)
  const row = await rows.get(id)
  if (!row || row.deleted_at) return
  const stamp = nextUpdatedAt(row.updated_at, at)
  await rows.put({ ...row, deleted_at: stamp, updated_at: stamp } as LocalRows[T])
  if (enqueueDelete) {
    await enqueue(db, { table, row_id: id, op: 'delete', updated_at: stamp, data: null })
  } else {
    await dropPending(db, table, id)
  }
}
