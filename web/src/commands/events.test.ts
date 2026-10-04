import { describe, expect, it } from 'vitest'
import { openTestDb } from '../test/db'
import { toChangeData } from '../db/types'
import { playEventRow, practiceSessionRow, recordingRow, scanViewRow } from '../test/rows'
import { recordEvent } from './events'

describe('recordEvent', () => {
  it('recordEvent writes the row and one outbox entry', async () => {
    const db = openTestDb()
    const play = playEventRow('play-1', { listened_ms: 12_000 })
    await recordEvent(db, 'play_events', play)
    expect(await db.play_events.get('play-1')).toEqual(play)
    expect(await db.outbox.toArray()).toEqual([
      {
        seq: expect.any(Number),
        table: 'play_events',
        row_id: 'play-1',
        op: 'upsert',
        updated_at: play.created_at,
        data: {
          context: 'row',
          created_at: play.created_at,
          started_at: play.started_at,
          listened_ms: play.listened_ms,
          recording_id: 'rec-1',
          link_id: null,
          list_id: null,
          tune_id: null,
        },
      },
    ])
  })

  it('stores a practice session in its own store', async () => {
    const db = openTestDb()
    const session = practiceSessionRow('session-1')
    await recordEvent(db, 'practice_sessions', session)
    expect(await db.practice_sessions.get('session-1')).toEqual(session)
    expect(await db.play_events.count()).toBe(0)
    expect((await db.outbox.toArray()).map((e) => [e.table, e.row_id])).toEqual([
      ['practice_sessions', 'session-1'],
    ])
  })

  it('pushes every column of a practice session but its id', async () => {
    const db = openTestDb()
    const session = practiceSessionRow('session-1', {
      duration_ms: 90_000,
      loop_ids: ['loop-1'],
      speed_percent: 80,
      pitch_cents: -50,
      tune_id: 'tune-1',
    })
    await recordEvent(db, 'practice_sessions', session)
    const { id, ...expected } = session
    const [entry] = await db.outbox.toArray()
    expect(id).toBe('session-1')
    expect(entry?.data).toEqual(expected)
    expect(entry?.data).toMatchObject({
      duration_ms: 90_000,
      loop_ids: ['loop-1'],
      speed_percent: 80,
      pitch_cents: -50,
      started_at: session.started_at,
      created_at: session.created_at,
      recording_id: 'rec-1',
      tune_id: 'tune-1',
    })
  })

  it('stores a scan view in its own store and pushes every column but its id', async () => {
    const db = openTestDb()
    const view = scanViewRow('view-1', { context: 'list', list_id: 'list-1', viewed_ms: 4_000 })
    await recordEvent(db, 'scan_views', view)
    expect(await db.scan_views.get('view-1')).toEqual(view)
    expect(await db.play_events.count()).toBe(0)
    const [entry] = await db.outbox.toArray()
    expect(entry).toMatchObject({ table: 'scan_views', row_id: 'view-1', op: 'upsert' })
    expect(entry?.data).toEqual({
      created_at: view.created_at,
      started_at: view.started_at,
      viewed_ms: 4_000,
      context: 'list',
      tune_id: view.tune_id,
      list_id: 'list-1',
    })
  })

  it('pushes the listened time, context, and start of a play', async () => {
    const db = openTestDb()
    const play = playEventRow('play-2', { listened_ms: 15_000 })
    await recordEvent(db, 'play_events', play)
    const [entry] = await db.outbox.toArray()
    expect(entry?.data).toMatchObject({
      listened_ms: 15_000,
      context: play.context,
      started_at: play.started_at,
    })
  })
})

describe('toChangeData', () => {
  it('drops the upload pipeline columns of a recording', () => {
    const data = toChangeData(
      recordingRow('rec-1', { duration_ms: 5000, state: 'ready' }),
      'recordings',
    )
    for (const key of ['state', 'duration_ms', 'playback_mime', 'playback_rev', 'peaks_rev']) {
      expect(data).not.toHaveProperty(key)
    }
    expect(data).toHaveProperty('trim_start_ms', 0)
  })
})
