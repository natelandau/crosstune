import { getPremiumHolds } from './meta'
import type { CrosstuneDb } from './schema'
import { isEventTable, isPremiumTable, type OutboxEntry, type TableName } from './types'

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

/** The row's queued change, if any; a file transfer waits while its row still has one. */
export function pendingFor(
  db: CrosstuneDb,
  table: TableName,
  rowId: string,
): Promise<OutboxEntry | undefined> {
  return db.outbox.where('[table+row_id]').equals([table, rowId]).first()
}

/** The tables whose rows name a recording in `recording_id`, which the server refuses while it
 * does not have that recording. */
const RECORDING_DEPENDENTS: readonly TableName[] = [
  'recording_loops',
  'play_events',
  'practice_sessions',
]

/** The recording a queued upsert of a recording-dependent row names, if any. */
export function dependentRecordingId(entry: OutboxEntry): string | null {
  if (entry.op === 'delete' || !RECORDING_DEPENDENTS.includes(entry.table)) return null
  const id = entry.data?.recording_id
  return typeof id === 'string' ? id : null
}

/**
 * The oldest queued changes first, at most `limit`. While not `premium`, a recording's or scan's
 * upsert the server refused for Premium stays out; so does any upsert of a row in `skip`. Every
 * upsert that names a recording left out stays out with it, since the server refuses it without
 * that recording. A delete always goes, so a held row never blocks its own removal.
 */
export async function pendingBatch(
  db: CrosstuneDb,
  limit = PUSH_BATCH_SIZE,
  { premium, skip }: { premium: boolean; skip?: ReadonlySet<string> } = { premium: true },
): Promise<OutboxEntry[]> {
  const left = new Set(skip)
  if (!premium) for (const id of await getPremiumHolds(db)) left.add(id)
  const entries = db.outbox.orderBy('seq')
  if (left.size === 0) return entries.limit(limit).toArray()
  return entries
    .filter((entry) => {
      const heldId = isPremiumTable(entry.table) ? entry.row_id : dependentRecordingId(entry)
      return entry.op === 'delete' || heldId === null || !left.has(heldId)
    })
    .limit(limit)
    .toArray()
}

/**
 * Discards a row's queued change without sending it, for a dependent whose own entry a
 * cascading parent delete makes redundant.
 */
export async function dropPending(db: CrosstuneDb, table: TableName, rowId: string): Promise<void> {
  await db.outbox.where('[table+row_id]').equals([table, rowId]).delete()
}

/** Queued changes other than events such as plays: the ones worth a sync of their own. */
export function countUnsentChanges(db: CrosstuneDb): Promise<number> {
  return db.outbox.filter((entry) => !isEventTable(entry.table)).count()
}
