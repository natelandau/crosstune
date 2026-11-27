import type { PullRow } from '../api/types'
import { openTestDb } from '../test/db'
import { describeSharedCases, loadSharedCases } from '../test/sharedCases'
import {
  expectLocalState,
  seedLocalState,
  type LocalState,
  type SyncPageCase,
} from '../test/syncCases'
import { applyPullPage } from './apply'

const cases = loadSharedCases<SyncPageCase, { local: LocalState }>(
  import.meta.glob('../../../fixtures/sync-pull/*.json', { eager: true, import: 'default' }),
  'web',
)

describeSharedCases('applyPullPage shared cases', cases, 9, async ({ input, expected }) => {
  const db = openTestDb()
  await seedLocalState(db, input.local)

  await applyPullPage(db, input.page.rows as PullRow[], input.page.next_since)

  await expectLocalState(db, expected.local)
})
