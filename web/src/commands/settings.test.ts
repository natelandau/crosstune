import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { setAudioQuality, setInstruments, settingsId, toggleInstrumentSetting } from './settings'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'))
})

afterEach(async () => {
  vi.useRealTimers()
  await db.delete()
})

describe('settingsId', () => {
  it('is stable for one user and distinct across users', () => {
    expect(settingsId('user_1')).toBe(settingsId('user_1'))
    expect(settingsId('user_1')).not.toBe(settingsId('user_2'))
    expect(settingsId('user_1')).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('setInstruments', () => {
  it('writes one row and queues it', async () => {
    await setInstruments(db, 'user_1', ['violin', 'banjo'])
    const rows = await db.user_settings.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: settingsId('user_1'),
      instruments: ['violin', 'banjo'],
      created_at: '2026-09-11T10:00:00.000Z',
      updated_at: '2026-09-11T10:00:00.000Z',
      deleted_at: null,
      server_seq: 0,
    })
    const batch = await pendingBatch(db, 10)
    expect(batch).toHaveLength(1)
    expect(batch[0]).toMatchObject({
      table: 'user_settings',
      row_id: settingsId('user_1'),
      op: 'upsert',
      data: { instruments: ['violin', 'banjo'], created_at: '2026-09-11T10:00:00.000Z' },
    })
  })

  it('updates the same row on a second call and keeps created_at', async () => {
    await setInstruments(db, 'user_1', ['violin'])
    vi.setSystemTime(new Date('2026-09-11T10:05:00.000Z'))
    await setInstruments(db, 'user_1', ['banjo'])
    const rows = await db.user_settings.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      instruments: ['banjo'],
      created_at: '2026-09-11T10:00:00.000Z',
      updated_at: '2026-09-11T10:05:00.000Z',
    })
  })

  it('dedupes a repeated instrument', async () => {
    await setInstruments(db, 'user_1', ['violin', 'violin'])
    const rows = await db.user_settings.toArray()
    expect(rows[0]?.instruments).toEqual(['violin'])
  })
})

describe('toggleInstrumentSetting', () => {
  it('preserves an instrument this client does not recognize', async () => {
    await db.user_settings.put({
      id: settingsId('user_1'),
      created_at: '2026-09-11T09:00:00.000Z',
      updated_at: '2026-09-11T09:00:00.000Z',
      deleted_at: null,
      server_seq: 0,
      instruments: ['violin', 'harmonica'],
      audio_quality: 'standard',
    })
    await toggleInstrumentSetting(db, 'user_1', 'banjo', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['violin', 'banjo', 'harmonica'])
  })

  it('dedupes a repeated unrecognized instrument', async () => {
    await db.user_settings.put({
      id: settingsId('user_1'),
      created_at: '2026-09-11T09:00:00.000Z',
      updated_at: '2026-09-11T09:00:00.000Z',
      deleted_at: null,
      server_seq: 0,
      instruments: ['violin', 'harmonica', 'harmonica'],
      audio_quality: 'standard',
    })
    await toggleInstrumentSetting(db, 'user_1', 'banjo', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['violin', 'banjo', 'harmonica'])
  })

  it('toggles on from no row against the default', async () => {
    await toggleInstrumentSetting(db, 'user_1', 'banjo', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['violin', 'banjo'])
  })

  it('toggles the only instrument off', async () => {
    await toggleInstrumentSetting(db, 'user_1', 'violin', false)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual([])
  })

  it('applies both toggles when two are issued without awaiting the first', async () => {
    const first = toggleInstrumentSetting(db, 'user_1', 'banjo', true)
    const second = toggleInstrumentSetting(db, 'user_1', 'violin', false)
    await Promise.all([first, second])
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['banjo'])
  })

  it('keeps the audio quality when instruments change and sets it on its own', async () => {
    await setAudioQuality(db, 'user_1', 'high')
    await toggleInstrumentSetting(db, 'user_1', 'banjo', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.audio_quality).toBe('high')
    expect(row?.instruments).toContain('banjo')
    expect((await pendingFor(db, 'user_settings', settingsId('user_1')))?.data).toMatchObject({
      audio_quality: 'high',
    })
  })
})
