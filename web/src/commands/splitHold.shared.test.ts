import { expect } from 'vitest'
import type { RecordingRow } from '../api/types'
import { holdsSplitAudio } from '../domain/recordingLimits'
import { describeSharedCases, loadSharedCases } from '../test/sharedCases'
import { recordingRow } from '../test/rows'
import { waitingParentIdsIn } from './recordings'

const cases = loadSharedCases<
  { recordings: Partial<RecordingRow>[]; excluded_piece_ids: string[] },
  { waiting_parent_ids: string[]; held_parent_ids: string[] }
>(
  import.meta.glob('../../../fixtures/split-hold/*.json', { eager: true, import: 'default' }),
  'web',
)

describeSharedCases('split parent hold shared cases', cases, 6, ({ input, expected }) => {
  const rows = input.recordings.map((row) => recordingRow(row.id!, row))
  const waiting = waitingParentIdsIn(rows, new Set(input.excluded_piece_ids))

  expect([...waiting].sort()).toEqual(expected.waiting_parent_ids)
  expect(
    rows
      .filter((row) => holdsSplitAudio(row, waiting))
      .map((row) => row.id)
      .sort(),
  ).toEqual(expected.held_parent_ids)
})
