import { expect } from 'vitest'
import type { ChangeResult } from '../api/types'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import type { OutboxEntry } from '../db/types'
import { openTestDb } from '../test/db'
import { describeSharedCases, loadSharedCases } from '../test/sharedCases'
import { expectLocalState, seedLocalState, type LocalState } from '../test/syncCases'
import { applyPushResults, type InvalidChange } from './apply'

interface PushResultsInput {
  local: LocalState
  sent: Omit<OutboxEntry, 'seq'>[]
  results: ChangeResult[]
}

interface PushResultsExpected {
  local: LocalState
  invalid: InvalidChange[]
  settled: number
  kept_local: string[]
}

const cases = loadSharedCases<PushResultsInput, PushResultsExpected>(
  import.meta.glob('../../../fixtures/sync-push-results/*.json', {
    eager: true,
    import: 'default',
  }),
  'web',
)

/** A sent entry carries the seq its row holds in the outbox, as a batch read from the queue does. */
async function withQueuedSeq(
  db: CrosstuneDb,
  entry: Omit<OutboxEntry, 'seq'>,
): Promise<OutboxEntry> {
  const queued = await pendingFor(db, entry.table, entry.row_id)
  expect(queued, `sent ${entry.table} ${entry.row_id} must be queued`).toBeDefined()
  return { ...entry, seq: queued!.seq }
}

describeSharedCases('applyPushResults shared cases', cases, 11, async ({ input, expected }) => {
  const db = openTestDb()
  await seedLocalState(db, input.local)
  const sent: OutboxEntry[] = []
  for (const entry of input.sent) sent.push(await withQueuedSeq(db, entry))

  const { invalid, settled, keptLocal } = await applyPushResults(db, sent, input.results)

  expect(invalid).toEqual(expected.invalid)
  expect(settled).toBe(expected.settled)
  expect(keptLocal).toEqual(expected.kept_local)
  await expectLocalState(db, expected.local)
})
