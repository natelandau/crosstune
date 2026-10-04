import { enqueue } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { toChangeData, type EventTable, type LocalEvent } from '../db/types'

/**
 * Store a play, practice session, or scan view and queue its insert. The queued entry waits for the next
 * sync another trigger starts; an event never starts one itself.
 */
export async function recordEvent(
  db: CrosstuneDb,
  table: EventTable,
  row: LocalEvent,
): Promise<void> {
  const store = db.table<LocalEvent, string>(table)
  await db.transaction('rw', store, db.outbox, async () => {
    await store.put(row)
    await enqueue(db, {
      table,
      row_id: row.id,
      op: 'upsert',
      updated_at: row.created_at,
      data: toChangeData(row, table),
    })
  })
}
