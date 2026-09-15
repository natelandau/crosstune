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

/** Store a row and queue its upsert. Call inside writeTx. */
export async function putRow<T extends TableName>(
  db: CrosstuneDb,
  table: T,
  row: LocalRows[T],
): Promise<void> {
  await rowsTable(db, table).put(row)
  await enqueue(db, {
    table,
    row_id: row.id,
    op: 'upsert',
    updated_at: row.updated_at,
    data: toChangeData(row),
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
  await rows.put({ ...row, deleted_at: at, updated_at: at } as LocalRows[T])
  if (enqueueDelete) {
    await enqueue(db, { table, row_id: id, op: 'delete', updated_at: at, data: null })
  } else {
    await dropPending(db, table, id)
  }
}
