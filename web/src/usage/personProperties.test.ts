import { describe, expect, it } from 'vitest'
import { setStorage } from '../db/meta'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { tuneRow, userTuneRow } from '../test/rows'
import { personProperties, type WebSettings } from './personProperties'

const settings: WebSettings = {
  instruments: ['violin'],
  audioQuality: 'standard',
  searchProviders: ['youtube'],
  playFirst: 'recordings',
  appearance: 'system',
  textSize: 'regular',
  downloadAll: false,
  newTuneStatus: 'want_to_learn',
  newTuneGenreSet: false,
}

const figures = { used_bytes: 0, quota_bytes: 1, max_file_bytes: 1 }

function storedDb(): Promise<CrosstuneDb> {
  const db = openTestDb()
  return setStorage(db, figures).then(() => db)
}

describe('personProperties', () => {
  it('reports only the device-local settings until the figures exist', async () => {
    const db = openTestDb()
    expect(await personProperties(db, settings)).toEqual({
      setting_appearance: 'system',
      setting_text_size: 0,
    })
  })

  it('reports the new-tune settings once the figures exist', async () => {
    const db = openTestDb()
    const chosen = { ...settings, newTuneStatus: 'learning', newTuneGenreSet: true }
    const before = await personProperties(db, chosen)
    expect(before).not.toHaveProperty('setting_new_tune_status')
    expect(before).not.toHaveProperty('setting_new_tune_genre_set')
    await setStorage(db, figures)
    expect(await personProperties(db, chosen)).toMatchObject({
      setting_new_tune_status: 'learning',
      setting_new_tune_genre_set: true,
    })
    const unknown = await personProperties(db, { ...settings, newTuneStatus: 'mastered' })
    expect(unknown).not.toHaveProperty('setting_new_tune_status')
    expect(unknown.setting_new_tune_genre_set).toBe(false)
  })

  it('counts live tunes only', async () => {
    const db = await storedDb()
    await db.tunes.bulkPut([tuneRow('t1', 'A'), tuneRow('t2', 'B'), tuneRow('t3', 'C')])
    await db.user_tunes.bulkPut([
      userTuneRow('u1', 't1'),
      userTuneRow('u2', 't2', { deleted_at: '2026-02-01T00:00:00.000Z' }),
    ])
    expect((await personProperties(db, settings)).catalog_size).toBe('1-9')
    await db.user_tunes.update('u1', { deleted_at: '2026-02-01T00:00:00.000Z' })
    expect((await personProperties(db, settings)).catalog_size).toBe('0')
  })

  it('leaves storage out until the figures exist', async () => {
    const db = openTestDb()
    expect(await personProperties(db, settings)).not.toHaveProperty('storage_used')
    await setStorage(db, { used_bytes: 20_000_000, quota_bytes: 1, max_file_bytes: 1 })
    expect((await personProperties(db, settings)).storage_used).toBe('10-50MB')
  })

  it('fields_used skips status and counts capo once set', async () => {
    const db = await storedDb()
    await db.tunes.bulkPut([
      tuneRow('t1', 'A', { key: 'D', tunings: { guitar: { tuning: ' ', capo: 0 } } }),
      tuneRow('t2', 'Gone', { composer: 'X', deleted_at: '2026-02-01T00:00:00.000Z' }),
    ])
    await db.user_tunes.bulkPut([
      userTuneRow('u1', 't1', { notes: 'slow', status: 'learning' }),
      userTuneRow('u2', 't2', { learned_from: 'Y' }),
    ])
    expect((await personProperties(db, settings)).fields_used).toEqual([
      'title',
      'key',
      'capo',
      'notes',
    ])
  })

  it('filters instruments to the vocabulary', async () => {
    const db = await storedDb()
    const person = await personProperties(db, {
      ...settings,
      instruments: ['guitar', 'theremin', 'violin'],
      textSize: 'roomy',
    })
    expect(person.setting_instruments).toEqual(['violin', 'guitar'])
    expect(person.setting_text_size).toBe(1)
  })
})
