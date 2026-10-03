import { beforeEach, describe, expect, it } from 'vitest'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { loopRow, recordingRow } from '../test/rows'
import { addLoop, removeLoop, updateLoop } from './loops'
import { LOOP_LIMIT, NO_ROOM, RECORDING_NOT_FOUND } from './messages'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await db.recordings.put(recordingRow('rec-1'))
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
    const b = await addLoop(db, 'rec-1', { start_ms: 1000, end_ms: 2000 }, '   ')
    expect((await db.recording_loops.get(a))?.label).toBeNull()
    expect((await db.recording_loops.get(b))?.label).toBeNull()
  })

  it('picks a color away from its neighbor', async () => {
    await db.recording_loops.put(loopRow({ id: 'a', start_ms: 0, end_ms: 2000, color: 0 }))
    const id = await addLoop(db, 'rec-1', { start_ms: 2000, end_ms: 4000 })
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
          start_ms: i * 1000,
          end_ms: i * 1000 + 500,
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

  it('clamps a new span that runs into a neighbor', async () => {
    await db.recording_loops.put(loopRow({ id: 'a', start_ms: 5000, end_ms: 8000 }))
    const id = await addLoop(db, 'rec-1', { start_ms: 1000, end_ms: 6000 })
    expect(await db.recording_loops.get(id)).toMatchObject({ start_ms: 1000, end_ms: 5000 })
  })

  it('clamps a new span that starts after the previous loop ends', async () => {
    await db.recording_loops.put(loopRow({ id: 'a', start_ms: 0, end_ms: 3000 }))
    const id = await addLoop(db, 'rec-1', { start_ms: 3000, end_ms: 6000 })
    expect(await db.recording_loops.get(id)).toMatchObject({ start_ms: 3000, end_ms: 6000 })
  })

  it('clamps a new span into the trimmed range', async () => {
    await db.recordings.put(recordingRow('trimmed', { trim_start_ms: 2000, trim_end_ms: 9000 }))
    const id = await addLoop(db, 'trimmed', { start_ms: 1000, end_ms: 20_000 })
    expect(await db.recording_loops.get(id)).toMatchObject({ start_ms: 2000, end_ms: 9000 })
  })

  it('refuses a span that starts inside a live loop', async () => {
    await db.recording_loops.put(loopRow({ id: 'a', start_ms: 1000, end_ms: 4000 }))
    await expect(addLoop(db, 'rec-1', { start_ms: 2000, end_ms: 6000 })).rejects.toThrow(NO_ROOM)
    expect(await db.recording_loops.count()).toBe(1)
  })

  it('refuses a span left under the minimum by its neighbor', async () => {
    await db.recording_loops.put(loopRow({ id: 'a', start_ms: 1300, end_ms: 4000 }))
    await expect(addLoop(db, 'rec-1', { start_ms: 1000, end_ms: 3000 })).rejects.toThrow(NO_ROOM)
  })

  it('ignores a deleted neighbor', async () => {
    await db.recording_loops.put(
      loopRow({ id: 'a', start_ms: 5000, end_ms: 8000, deleted_at: '2026-02-01T00:00:00.000Z' }),
    )
    const id = await addLoop(db, 'rec-1', { start_ms: 1000, end_ms: 6000 })
    expect(await db.recording_loops.get(id)).toMatchObject({ start_ms: 1000, end_ms: 6000 })
  })

  it('stops an updated edge at the neighbor', async () => {
    await db.recording_loops.bulkPut([
      loopRow({ id: 'a', start_ms: 0, end_ms: 2000 }),
      loopRow({ id: 'b', start_ms: 3000, end_ms: 5000 }),
      loopRow({ id: 'c', start_ms: 7000, end_ms: 9000 }),
    ])
    await updateLoop(db, 'b', { start_ms: 500, end_ms: 20_000 })
    expect(await db.recording_loops.get('b')).toMatchObject({ start_ms: 2000, end_ms: 7000 })
  })

  it('does not let a deleted neighbor stop an updated edge', async () => {
    await db.recording_loops.bulkPut([
      loopRow({ id: 'a', start_ms: 0, end_ms: 2000, deleted_at: '2026-02-01T00:00:00.000Z' }),
      loopRow({ id: 'b', start_ms: 3000, end_ms: 5000 }),
    ])
    await updateLoop(db, 'b', { start_ms: 500 })
    expect(await db.recording_loops.get('b')).toMatchObject({ start_ms: 500, end_ms: 5000 })
  })

  it('refuses an update that leaves under the minimum', async () => {
    await db.recording_loops.bulkPut([
      loopRow({ id: 'a', start_ms: 0, end_ms: 2000 }),
      loopRow({ id: 'b', start_ms: 3000, end_ms: 5000 }),
    ])
    await expect(updateLoop(db, 'b', { start_ms: 1000, end_ms: 1400 })).rejects.toThrow(NO_ROOM)
    expect(await db.recording_loops.get('b')).toMatchObject({ start_ms: 3000, end_ms: 5000 })
  })

  it('leaves a label-only update alone', async () => {
    await db.recording_loops.bulkPut([
      loopRow({ id: 'a', start_ms: 0, end_ms: 4000 }),
      loopRow({ id: 'b', start_ms: 3000, end_ms: 5000 }),
    ])
    await updateLoop(db, 'b', { label: 'Tag' })
    expect(await db.recording_loops.get('b')).toMatchObject({
      start_ms: 3000,
      end_ms: 5000,
      label: 'Tag',
    })
  })
})
