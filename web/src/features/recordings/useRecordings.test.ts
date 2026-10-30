import { describe, expect, it } from 'vitest'
import { openTestDb } from '../../test/db'
import { captureRecording } from '../../test/recordings'
import { placeRow, recordingRow } from '../../test/rows'
import { readRecordingsWithFiles } from './useRecordings'

describe('readRecordingsWithFiles', () => {
  it('marks a parent held only while a live piece split from it waits for its cut', async () => {
    const db = openTestDb()
    await db.recordings.bulkPut([
      recordingRow('parent', { tune_id: 't1', state: 'ready' }),
      recordingRow('failed', { tune_id: 't1', state: 'failed' }),
      recordingRow('done', { tune_id: 't1', state: 'ready' }),
      recordingRow('p1', { split_from_id: 'parent', state: 'processing' }),
      recordingRow('p2', { split_from_id: 'failed', state: 'processing' }),
      recordingRow('p3', { split_from_id: 'done', state: 'ready' }),
    ])
    for (const tuneId of [undefined, 't1']) {
      const views = await readRecordingsWithFiles(db, { tuneId })
      const held = views.filter((v) => v.holdsSplitAudio).map((v) => v.recording.id)
      expect(held).toEqual(['parent'])
    }
  })

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

  it('names the location each recording shows: its saved location, else its own name', async () => {
    const db = openTestDb()
    await db.places.bulkPut([
      placeRow('p1', 'Town Hall'),
      placeRow('p2', 'Old Barn', { deleted_at: '2026-02-01T00:00:00.000Z' }),
    ])
    const linked = await captureRecording(db, { place_name: '1 Main St' })
    await db.recordings.update(linked, { place_id: 'p1' })
    const unnamed = await captureRecording(db)
    await db.recordings.update(unnamed, { place_id: 'p1' })
    const dropped = await captureRecording(db, { place_name: 'Galax, VA' })
    await db.recordings.update(dropped, { place_id: 'p2' })
    const plain = await captureRecording(db)

    const shown = new Map(
      (await readRecordingsWithFiles(db)).map((v) => [v.recording.id, v.shownPlace]),
    )

    expect(shown.get(linked)).toBe('Town Hall')
    expect(shown.get(unnamed)).toBe('Town Hall')
    expect(shown.get(dropped)).toBe('Galax, VA')
    expect(shown.get(plain)).toBeNull()
  })
})
