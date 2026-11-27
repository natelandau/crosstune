import type { EventRow } from '../api/types'
import { openTestDb } from '../test/db'
import { describeSharedCases, loadSharedCases } from '../test/sharedCases'
import {
  expectLocalState,
  seedLocalState,
  type LocalState,
  type SyncPageCase,
} from '../test/syncCases'
import { applyEventsPage } from './apply'

const cases = loadSharedCases<SyncPageCase, { local: LocalState }>(
  import.meta.glob('../../../fixtures/sync-events/*.json', { eager: true, import: 'default' }),
  'web',
)

describeSharedCases('applyEventsPage shared cases', cases, 3, async ({ input, expected }) => {
  const db = openTestDb()
  await seedLocalState(db, input.local)

  await applyEventsPage(db, input.page.rows as EventRow[], input.page.next_since)

  await expectLocalState(db, expected.local)
})
