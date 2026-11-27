import { expect } from 'vitest'
import { openTestDb } from '../test/db'
import { describeSharedCases, loadSharedCases } from '../test/sharedCases'
import { enqueue } from './outbox'
import type { OutboxEntry } from './types'

type Entry = Omit<OutboxEntry, 'seq'>

const cases = loadSharedCases<{ outbox: Entry[]; enqueue: Entry[] }, { outbox: Entry[] }>(
  import.meta.glob('../../../fixtures/outbox/*.json', { eager: true, import: 'default' }),
  'web',
)

describeSharedCases('enqueue shared cases', cases, 5, async ({ input, expected }) => {
  const db = openTestDb()
  for (const entry of [...input.outbox, ...input.enqueue]) await enqueue(db, entry)

  const queued = await db.outbox.orderBy('seq').toArray()
  expect(queued.map(({ seq: _seq, ...entry }) => entry)).toEqual(expected.outbox)
})
