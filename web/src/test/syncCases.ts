import { expect } from 'vitest'
import {
  getEventsCursor,
  getLocalOnlyRows,
  getPullCursor,
  keepLocalUntilSubscribed,
  setEventsCursor,
  setPullCursor,
} from '../db/meta'
import { enqueue } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import type { OutboxEntry } from '../db/types'
import { expectSameInstant, ISO_TIMESTAMP } from './sharedCases'

type WireRow = Record<string, unknown> & { id: string }

/**
 * A local database as the fixtures/sync-pull, fixtures/sync-events, fixtures/sync-push-results,
 * and fixtures/sync-engine cases state it, with the recordings and scans kept local until
 * subscribed and the fields no stored row of a table may carry.
 */
export interface LocalState {
  rows: Record<string, WireRow[]>
  outbox: Omit<OutboxEntry, 'seq'>[]
  pull_cursor: number
  events_cursor: number
  local_only?: string[]
  absent_fields?: Record<string, string[]>
}

/** One page of the pull or the events pull, as a case states it. */
export interface SyncPage {
  rows: { table: string; row: WireRow }[]
  next_since: number
}

export interface SyncPageCase {
  local: LocalState
  page: SyncPage
}

/** Store a case's starting database: its rows, queued changes, holds, and cursors. */
export async function seedLocalState(db: CrosstuneDb, local: LocalState): Promise<void> {
  for (const [table, rows] of Object.entries(local.rows)) await db.table(table).bulkPut(rows)
  for (const entry of local.outbox) await enqueue(db, entry)
  await keepLocalUntilSubscribed(db, local.local_only ?? [])
  await setPullCursor(db, local.pull_cursor)
  await setEventsCursor(db, local.events_cursor)
}

/**
 * Assert the database matches a case's expected state: the tables it names hold exactly its
 * rows, each compared on the fields the expected row carries, timestamps by instant, no row
 * carries a field listed in `absent_fields`, and the holds that count match `local_only`.
 */
export async function expectLocalState(db: CrosstuneDb, expected: LocalState): Promise<void> {
  for (const [table, expectedRows] of Object.entries(expected.rows)) {
    const actualRows = (await db.table(table).toArray()) as WireRow[]
    const byId = new Map(actualRows.map((row) => [row.id, row]))
    expect([...byId.keys()].sort(), `${table} ids`).toEqual(
      expectedRows.map((row) => row.id).sort(),
    )
    for (const expectedRow of expectedRows) {
      const actualRow = byId.get(expectedRow.id)!
      for (const [field, value] of Object.entries(expectedRow)) {
        expect(
          Object.hasOwn(actualRow, field),
          `${table} ${expectedRow.id}: field ${field} must be present`,
        ).toBe(true)
        const actual = actualRow[field]
        if (typeof value === 'string' && typeof actual === 'string' && ISO_TIMESTAMP.test(value)) {
          expectSameInstant(actual, value)
        } else {
          expect(actual, `${table} ${expectedRow.id} ${field}`).toEqual(value)
        }
      }
    }
  }
  for (const [table, fields] of Object.entries(expected.absent_fields ?? {})) {
    for (const row of (await db.table(table).toArray()) as WireRow[]) {
      for (const field of fields) {
        expect(Object.hasOwn(row, field), `${table} ${row.id}: field ${field} must be absent`).toBe(
          false,
        )
      }
    }
  }
  const queued = await db.outbox.orderBy('seq').toArray()
  expect(queued.map(({ seq: _seq, ...entry }) => entry)).toEqual(expected.outbox)
  if (expected.local_only !== undefined) {
    expect([...(await getLocalOnlyRows(db))].sort(), 'local_only').toEqual(
      [...expected.local_only].sort(),
    )
  }
  expect(await getPullCursor(db)).toBe(expected.pull_cursor)
  expect(await getEventsCursor(db)).toBe(expected.events_cursor)
}
