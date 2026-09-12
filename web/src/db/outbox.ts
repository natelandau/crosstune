import type { CrosstuneDb } from './schema'
import type { OutboxEntry, TableName } from './types'

export const PUSH_BATCH_SIZE = 500

/** Queue a change. A row has at most one entry: the newest write carries the whole row. */
export async function enqueue(db: CrosstuneDb, entry: Omit<OutboxEntry, 'seq'>): Promise<void> {
  // The read and write must share a transaction: otherwise two concurrent enqueues for the
  // same row can both see no existing entry and collide on the unique [table+row_id] index.
  await db.transaction('rw', db.outbox, async () => {
    const existing = await pendingFor(db, entry.table, entry.row_id)
    if (existing?.seq !== undefined) {
      await db.outbox.put({ ...entry, seq: existing.seq })
    } else {
      await db.outbox.add(entry)
    }
  })
}

export function pendingFor(
  db: CrosstuneDb,
  table: TableName,
  rowId: string,
): Promise<OutboxEntry | undefined> {
  return db.outbox.where('[table+row_id]').equals([table, rowId]).first()
}

export function pendingBatch(db: CrosstuneDb, limit = PUSH_BATCH_SIZE): Promise<OutboxEntry[]> {
  return db.outbox.orderBy('seq').limit(limit).toArray()
}

export async function dropPending(db: CrosstuneDb, table: TableName, rowId: string): Promise<void> {
  await db.outbox.where('[table+row_id]').equals([table, rowId]).delete()
}
