import { describe, expect, it } from 'vitest'
import { openTestDb } from '../../test/db'
import { recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { deleteTuneMessage } from './deleteTuneMessage'
import { deleteTunesQuestion } from './deleteTuneQuestion'

describe('deleteTunesQuestion', () => {
  it('leaves out a split parent the delete keeps for its waiting piece', async () => {
    const db = openTestDb()
    const tune = tuneRow('t1', 'Old Joe Clark')
    const userTune = userTuneRow('u-t1', 't1')
    await db.recordings.bulkPut([
      recordingRow('parent', { tune_id: 't1', state: 'ready', split_id: 's1', split_size: 2 }),
      recordingRow('piece', {
        state: 'processing',
        split_from_id: 'parent',
        created_by_split_id: 's1',
      }),
      recordingRow('other', { tune_id: 't1', state: 'ready' }),
    ])
    await db.recording_files.bulkPut([
      recordingFile('parent', { local_state: 'captured' }),
      recordingFile('other', { local_state: 'uploaded' }),
    ])

    const question = await deleteTunesQuestion(db, [{ tune, userTune }])

    expect(question.message).toBe(deleteTuneMessage([{ file: { local_state: 'uploaded' } }]))
  })
})
