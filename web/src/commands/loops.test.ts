import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { loopRow, recordingRow } from '../test/rows'
import { addLoop, removeLoop, restoreLoop, updateLoop } from './loops'
import { LOOP_LIMIT, RECORDING_NOT_FOUND } from './messages'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await db.recordings.put(recordingRow('rec-1'))
})

afterEach(async () => {
  await db.delete()
})

describe('loops', () => {
  it('writes a row and one upsert for a new loop', async () => {
    const id = await addLoop(db, 'rec-1', { start_ms: 1000, end_ms: 4000 }, 'Bridge')
    expect(await db.recording_loops.get(id)).toMatchObject({
      recording_id: 'rec-1',
      start_ms: 1000,
      end_ms: 4000,
      label: 'Bridge',
      color: 0,
      deleted_at: null,
    })
    expect(await db.outbox.count()).toBe(1)
    expect(await pendingFor(db, 'recording_loops', id)).toMatchObject({ op: 'upsert' })
  })

  it('stores a blank or omitted label as null', async () => {
    const a = await addLoop(db, 'rec-1', { start_ms: 0, end_ms: 1000 })
    const b = await addLoop(db, 'rec-1', { start_ms: 0, end_ms: 1000 }, '   ')
    expect((await db.recording_loops.get(a))?.label).toBeNull()
    expect((await db.recording_loops.get(b))?.label).toBeNull()
  })

  it('picks a color away from the loops it overlaps', async () => {
    await db.recording_loops.put(loopRow({ id: 'a', start_ms: 0, end_ms: 2000, color: 0 }))
    const id = await addLoop(db, 'rec-1', { start_ms: 1000, end_ms: 3000 })
    expect((await db.recording_loops.get(id))?.color).not.toBe(0)
  })

  it('throws for an unknown or deleted recording', async () => {
    await expect(addLoop(db, 'nope', { start_ms: 0, end_ms: 1000 })).rejects.toThrow(
      RECORDING_NOT_FOUND,
    )
    await db.recordings.put(recordingRow('gone', { deleted_at: '2026-02-01T00:00:00.000Z' }))
    await expect(addLoop(db, 'gone', { start_ms: 0, end_ms: 1000 })).rejects.toThrow(
      RECORDING_NOT_FOUND,
    )
  })

  it('rejects the 101st live loop and ignores deleted ones in the count', async () => {
    await db.recording_loops.bulkPut(
      Array.from({ length: 100 }, (_, i) =>
        loopRow({
          id: `l${i}`,
          start_ms: i * 10,
          end_ms: i * 10 + 5,
          deleted_at: i === 0 ? '2026-02-01T00:00:00.000Z' : null,
        }),
      ),
    )
    await expect(addLoop(db, 'rec-1', { start_ms: 0, end_ms: 1000 })).resolves.toEqual(
      expect.any(String),
    )
    await expect(addLoop(db, 'rec-1', { start_ms: 0, end_ms: 1000 })).rejects.toThrow(LOOP_LIMIT)
  })

  it('stamps a newer updated_at on an update', async () => {
    const id = await addLoop(db, 'rec-1', { start_ms: 1000, end_ms: 4000 })
    const before = await db.recording_loops.get(id)
    await updateLoop(db, id, { end_ms: 5000, label: 'Tag' })
    const after = await db.recording_loops.get(id)
    expect(after).toMatchObject({ start_ms: 1000, end_ms: 5000, label: 'Tag' })
    expect(Date.parse(after!.updated_at)).toBeGreaterThan(Date.parse(before!.updated_at))
  })

  it('enqueues a delete on remove', async () => {
    const id = await addLoop(db, 'rec-1', { start_ms: 0, end_ms: 1000 })
    await removeLoop(db, id)
    expect((await db.recording_loops.get(id))?.deleted_at).not.toBeNull()
    expect(await pendingFor(db, 'recording_loops', id)).toMatchObject({ op: 'delete' })
  })

  it('restores a removed loop as an upsert of its original span', async () => {
    const id = await addLoop(db, 'rec-1', { start_ms: 1000, end_ms: 4000 }, 'Bridge')
    await removeLoop(db, id)
    await restoreLoop(db, id)
    expect(await db.recording_loops.get(id)).toMatchObject({
      deleted_at: null,
      start_ms: 1000,
      end_ms: 4000,
      label: 'Bridge',
    })
    expect(await pendingFor(db, 'recording_loops', id)).toMatchObject({
      op: 'upsert',
      data: expect.objectContaining({ start_ms: 1000, end_ms: 4000 }),
    })
  })

  it('refuses to restore a loop past the cap and leaves it deleted', async () => {
    const id = await addLoop(db, 'rec-1', { start_ms: 0, end_ms: 1000 })
    await removeLoop(db, id)
    await db.recording_loops.bulkPut(
      Array.from({ length: 100 }, (_, i) => loopRow({ id: `l${i}`, start_ms: i, end_ms: i + 600 })),
    )
    await expect(restoreLoop(db, id)).rejects.toThrow(LOOP_LIMIT)
    expect((await db.recording_loops.get(id))?.deleted_at).not.toBeNull()
  })

  it('refuses to restore a loop whose recording is gone', async () => {
    const id = await addLoop(db, 'rec-1', { start_ms: 0, end_ms: 1000 })
    await removeLoop(db, id)
    await db.recordings.update('rec-1', { deleted_at: '2026-02-01T00:00:00.000Z' })
    await expect(restoreLoop(db, id)).rejects.toThrow(RECORDING_NOT_FOUND)
    expect((await db.recording_loops.get(id))?.deleted_at).not.toBeNull()
  })
})
