import { beforeEach, describe, expect, it } from 'vitest'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { loopRow, recordingFile, recordingRow } from '../test/rows'
import { SPLIT_INVALID, SPLIT_OPEN } from './messages'
import { splitRecording } from './split'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await db.recordings.put(recordingRow('rec-1', { trim_end_ms: 180_000, label: 'Session' }))
})

describe('splitRecording', () => {
  it('narrows the parent and creates one row per later piece', async () => {
    const ids = await splitRecording(db, 'rec-1', [120_000, 60_000])
    const parent = await db.recordings.get('rec-1')
    expect(ids).toHaveLength(2)
    expect(parent).toMatchObject({ trim_start_ms: 0, trim_end_ms: 60_000, split_size: 3 })
    expect(parent?.split_id).toBeTruthy()
    const pieces = await Promise.all(ids.map((id) => db.recordings.get(id)))
    expect(pieces[0]).toMatchObject({ trim_start_ms: 60_000, trim_end_ms: 120_000 })
    expect(pieces[1]).toMatchObject({ trim_start_ms: 120_000, trim_end_ms: 180_000 })
    for (const piece of pieces) {
      expect(piece).toMatchObject({
        split_from_id: 'rec-1',
        created_by_split_id: parent?.split_id,
        split_id: null,
        split_size: null,
        split_completed_id: null,
        state: 'processing',
      })
    }
  })

  it('copies date, place, players, notes, speed, pitch, origin, and source; leaves tune unset', async () => {
    await db.recordings.put(
      recordingRow('rec-1', {
        trim_end_ms: 180_000,
        tune_id: 'tune-1',
        recorded_at: '2026-02-02T10:00:00.000Z',
        players: 'Ann',
        notes: 'n',
        place_name: 'Hall',
        place_lat: 1,
        place_lon: 2,
        place_origin: 'device',
        speed_percent: 80,
        pitch_cents: 50,
        origin: 'other',
        origin_url: 'https://x.test',
        source: 'upload',
      }),
    )
    const [id] = await splitRecording(db, 'rec-1', [60_000])
    expect(await db.recordings.get(id!)).toMatchObject({
      tune_id: null,
      recorded_at: '2026-02-02T10:00:00.000Z',
      players: 'Ann',
      notes: 'n',
      place_name: 'Hall',
      place_lat: 1,
      place_lon: 2,
      place_origin: 'device',
      speed_percent: 80,
      pitch_cents: 50,
      origin: 'other',
      origin_url: 'https://x.test',
      source: 'upload',
    })
  })

  it('labels pieces from the parent label', async () => {
    const [a] = await splitRecording(db, 'rec-1', [60_000])
    expect((await db.recordings.get(a!))?.label).toBe('Session, part 2')
    await db.recordings.put(recordingRow('rec-2', { trim_end_ms: 90_000 }))
    const [b] = await splitRecording(db, 'rec-2', [30_000])
    expect((await db.recordings.get(b!))?.label).toBe('Part 2')
  })

  it('moves a loop inside piece 2 and deletes a loop crossing a cut', async () => {
    await db.recording_loops.bulkPut([
      loopRow({ id: 'in1', start_ms: 1000, end_ms: 3000 }),
      loopRow({ id: 'in2', start_ms: 70_000, end_ms: 80_000, label: 'B', color: 2 }),
      loopRow({ id: 'cross', start_ms: 50_000, end_ms: 70_000 }),
    ])
    const [piece] = await splitRecording(db, 'rec-1', [60_000, 120_000])
    const loops = await db.recording_loops.toArray()
    const live = loops.filter((l) => !l.deleted_at)
    expect(live.map((l) => l.id)).toContain('in1')
    expect(live.filter((l) => l.recording_id === piece)).toMatchObject([
      { start_ms: 70_000, end_ms: 80_000, label: 'B', color: 2 },
    ])
    expect(loops.find((l) => l.id === 'in2')?.deleted_at).not.toBeNull()
    expect(loops.find((l) => l.id === 'cross')?.deleted_at).not.toBeNull()
  })

  it('queues every row in the outbox', async () => {
    const ids = await splitRecording(db, 'rec-1', [60_000, 120_000])
    for (const id of ['rec-1', ...ids]) {
      expect(await pendingFor(db, 'recordings', id)).toMatchObject({ op: 'upsert' })
    }
  })

  it('splits a freshly captured row using the file length', async () => {
    await db.recordings.put(recordingRow('rec-4'))
    await db.recording_files.put(recordingFile('rec-4', { local_duration_ms: 90_000 }))
    const [id] = await splitRecording(db, 'rec-4', [30_000])
    expect(await db.recordings.get('rec-4')).toMatchObject({ trim_end_ms: 30_000 })
    expect(await db.recordings.get(id!)).toMatchObject({
      trim_start_ms: 30_000,
      trim_end_ms: 90_000,
    })
  })

  it('keeps loops in the first piece and moves one starting at a cut', async () => {
    await db.recording_loops.bulkPut([
      loopRow({ id: 'first', start_ms: 1000, end_ms: 59_000 }),
      loopRow({ id: 'edge', start_ms: 60_000, end_ms: 70_000 }),
    ])
    const [piece] = await splitRecording(db, 'rec-1', [60_000])
    const live = (await db.recording_loops.toArray()).filter((l) => !l.deleted_at)
    expect(live.find((l) => l.id === 'first')?.recording_id).toBe('rec-1')
    expect(live.filter((l) => l.recording_id === piece)).toMatchObject([{ start_ms: 60_000 }])
  })

  describe('refusals', () => {
    const refusal = (id: string, cuts: number[]) => splitRecording(db, id, cuts)

    it('rejects a cut outside the range', async () => {
      await expect(refusal('rec-1', [180_000])).rejects.toThrow(SPLIT_INVALID)
      await expect(refusal('rec-1', [0])).rejects.toThrow(SPLIT_INVALID)
    })

    it('rejects a piece under 1 second', async () => {
      await expect(refusal('rec-1', [500])).rejects.toThrow(SPLIT_INVALID)
      await expect(refusal('rec-1', [60_000, 60_500])).rejects.toThrow(SPLIT_INVALID)
    })

    it('rejects a piece over 3 hours', async () => {
      await db.recordings.put(recordingRow('rec-long', { trim_end_ms: 4 * 3_600_000 }))
      await expect(refusal('rec-long', [1_800_000])).rejects.toThrow(SPLIT_INVALID)
    })

    it('rejects more than 50 pieces', async () => {
      const many = Array.from({ length: 50 }, (_, i) => (i + 1) * 3000)
      await expect(refusal('rec-1', many)).rejects.toThrow(SPLIT_INVALID)
    })

    it('rejects a recording whose split is still open', async () => {
      await db.recordings.put(
        recordingRow('rec-3', { trim_end_ms: 90_000, split_id: 's', split_size: 2 }),
      )
      await expect(refusal('rec-3', [30_000])).rejects.toThrow(SPLIT_OPEN)
    })
  })
})
