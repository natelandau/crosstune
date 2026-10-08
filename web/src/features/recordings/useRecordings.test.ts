import { describe, expect, it } from 'vitest'
import { openTestDb } from '../../test/db'
import { captureRecording } from '../../test/recordings'
import { readRecordingsWithFiles } from './useRecordings'

describe('readRecordingsWithFiles', () => {
  it('pairs each recording with its local file', async () => {
    const db = openTestDb()
    const id = await captureRecording(db)

    const [view] = await readRecordingsWithFiles(db)

    expect(view?.recording.id).toBe(id)
    expect(view?.file?.id).toBe(id)
  })

  it('leaves the file out when the caller does not need it', async () => {
    const db = openTestDb()
    const id = await captureRecording(db)

    const [view] = await readRecordingsWithFiles(db, { withFiles: false })

    expect(view?.recording.id).toBe(id)
    expect(view?.file).toBeUndefined()
  })
})
