import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { PROVIDERS } from '../api/vocabulary'
import { SEARCHABLE_PROVIDERS, storedSearchProviders, type LocalUserSettings } from '../db/types'
import {
  setAudioQuality,
  setInstruments,
  setNewTuneGenre,
  setNewTuneStatus,
  setPlayFirst,
  settingsId,
  toggleInstrumentSetting,
  toggleSearchProvider,
} from './settings'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'))
})

afterEach(async () => {
  vi.useRealTimers()
})

/** Store a pulled settings row for user_1, as a newer server might send it. */
async function putStoredRow(fields: Record<string, unknown>): Promise<void> {
  const at = '2026-09-11T09:00:00.000Z'
  await db.user_settings.put({
    id: settingsId('user_1'),
    created_at: at,
    updated_at: at,
    deleted_at: null,
    server_seq: 1,
    instruments: [],
    audio_quality: 'standard',
    play_first: 'recordings',
    search_providers: [],
    new_tune_genre: null,
    new_tune_status: 'want_to_learn',
    ...fields,
  } as never)
}

describe('settingsId', () => {
  it('is stable for one user and distinct across users', () => {
    expect(settingsId('user_1')).toBe(settingsId('user_1'))
    expect(settingsId('user_1')).not.toBe(settingsId('user_2'))
    expect(settingsId('user_1')).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('setInstruments', () => {
  it('writes one row and queues it', async () => {
    await setInstruments(db, 'user_1', ['violin', 'five_string_banjo'])
    const rows = await db.user_settings.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: settingsId('user_1'),
      instruments: ['violin', 'five_string_banjo'],
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
      data: {
        instruments: ['violin', 'five_string_banjo'],
        created_at: '2026-09-11T10:00:00.000Z',
      },
    })
  })

  it('updates the same row on a second call and keeps created_at', async () => {
    await setInstruments(db, 'user_1', ['violin'])
    vi.setSystemTime(new Date('2026-09-11T10:05:00.000Z'))
    await setInstruments(db, 'user_1', ['five_string_banjo'])
    const rows = await db.user_settings.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      instruments: ['five_string_banjo'],
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
      play_first: 'recordings',
      new_tune_genre: null,
      new_tune_status: 'want_to_learn',
    })
    await toggleInstrumentSetting(db, 'user_1', 'five_string_banjo', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['violin', 'five_string_banjo', 'harmonica'])
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
      play_first: 'recordings',
      new_tune_genre: null,
      new_tune_status: 'want_to_learn',
    })
    await toggleInstrumentSetting(db, 'user_1', 'five_string_banjo', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['violin', 'five_string_banjo', 'harmonica'])
  })

  it('toggles on from no row', async () => {
    await toggleInstrumentSetting(db, 'user_1', 'five_string_banjo', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['five_string_banjo'])
  })

  it('toggles the only instrument off', async () => {
    await toggleInstrumentSetting(db, 'user_1', 'violin', false)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual([])
  })

  it('applies both toggles when two are issued without awaiting the first', async () => {
    const first = toggleInstrumentSetting(db, 'user_1', 'five_string_banjo', true)
    const second = toggleInstrumentSetting(db, 'user_1', 'violin', false)
    await Promise.all([first, second])
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['five_string_banjo'])
  })

  it('keeps the audio quality when instruments change and sets it on its own', async () => {
    await setAudioQuality(db, 'user_1', 'high')
    await toggleInstrumentSetting(db, 'user_1', 'five_string_banjo', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.audio_quality).toBe('high')
    expect(row?.instruments).toContain('five_string_banjo')
    expect((await pendingFor(db, 'user_settings', settingsId('user_1')))?.data).toMatchObject({
      audio_quality: 'high',
    })
  })
})

describe('setPlayFirst', () => {
  it('sets play_first and keeps the other choices', async () => {
    await setAudioQuality(db, 'user_1', 'high')
    await toggleSearchProvider(db, 'user_1', 'youtube', false)
    await setPlayFirst(db, 'user_1', 'apple_music')
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.play_first).toBe('apple_music')
    expect(row?.audio_quality).toBe('high')
    expect(row?.search_providers).not.toContain('youtube')
    expect((await pendingFor(db, 'user_settings', settingsId('user_1')))?.data).toMatchObject({
      play_first: 'apple_music',
    })
  })

  it('survives other settings edits', async () => {
    await setPlayFirst(db, 'user_1', 'apple_music')
    await setAudioQuality(db, 'user_1', 'high')
    expect((await db.user_settings.get(settingsId('user_1')))?.play_first).toBe('apple_music')
  })

  it('keeps a value this client does not know through other settings edits', async () => {
    await putStoredRow({ play_first: 'future_choice' })
    await setInstruments(db, 'user_1', ['violin'])
    expect((await db.user_settings.get(settingsId('user_1')))?.play_first).toBe('future_choice')
    expect((await pendingFor(db, 'user_settings', settingsId('user_1')))?.data).toMatchObject({
      play_first: 'future_choice',
    })
  })
})

describe('setAudioQuality', () => {
  it('keeps a value this client does not know through other settings edits', async () => {
    await putStoredRow({ audio_quality: 'lossless' })
    await setInstruments(db, 'user_1', ['violin'])
    expect((await db.user_settings.get(settingsId('user_1')))?.audio_quality).toBe('lossless')
    expect((await pendingFor(db, 'user_settings', settingsId('user_1')))?.data).toMatchObject({
      audio_quality: 'lossless',
    })
  })
})

describe('writeSettings', () => {
  it('keeps a server field this client does not know and pushes it back', async () => {
    await putStoredRow({ future_field: 'kept' })
    await setInstruments(db, 'user_1', ['violin'])
    const row = (await db.user_settings.get(settingsId('user_1'))) as unknown as Record<
      string,
      unknown
    >
    expect(row.future_field).toBe('kept')
    expect((await pendingFor(db, 'user_settings', settingsId('user_1')))?.data).toMatchObject({
      future_field: 'kept',
    })
  })
})

describe('the five-string banjo', () => {
  it('is stored and pushed under its own name', async () => {
    await setInstruments(db, 'user_1', ['five_string_banjo'])
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.instruments).toEqual(['five_string_banjo'])
    expect(
      (await pendingFor(db, 'user_settings', settingsId('user_1')))?.data?.instruments,
    ).toEqual(['five_string_banjo'])
  })
})

describe('storedSearchProviders', () => {
  it('falls back to every searchable provider without a row or the field', () => {
    expect(storedSearchProviders(null)).toEqual(SEARCHABLE_PROVIDERS)
    expect(storedSearchProviders(undefined)).toEqual(SEARCHABLE_PROVIDERS)
    expect(storedSearchProviders({} as LocalUserSettings)).toEqual(SEARCHABLE_PROVIDERS)
    expect(SEARCHABLE_PROVIDERS).toHaveLength(8)
    expect(SEARCHABLE_PROVIDERS).not.toContain('other')
  })

  it('lists every provider but other, in the order results group', () => {
    expect(SEARCHABLE_PROVIDERS).toEqual([
      'apple_music',
      'tidal',
      'internet_archive',
      'slippery_hill',
      'youtube',
      'spotify',
      'bandcamp',
      'soundcloud',
    ])
    expect(new Set(SEARCHABLE_PROVIDERS)).toEqual(new Set(PROVIDERS.filter((p) => p !== 'other')))
  })

  it('falls back to every searchable provider for a deleted row', () => {
    const row = {
      deleted_at: '2026-09-11T10:00:00.000Z',
      search_providers: ['tidal'],
    } as unknown as LocalUserSettings
    expect(storedSearchProviders(row)).toEqual(SEARCHABLE_PROVIDERS)
  })

  it('keeps an empty choice empty', () => {
    expect(storedSearchProviders({ search_providers: [] } as unknown as LocalUserSettings)).toEqual(
      [],
    )
  })
})

describe('toggleSearchProvider', () => {
  it('writes the row and queues one entry carrying the field, off then on', async () => {
    await toggleSearchProvider(db, 'user_1', 'tidal', false)
    const off = await db.user_settings.get(settingsId('user_1'))
    expect(off?.search_providers).toEqual(SEARCHABLE_PROVIDERS.filter((p) => p !== 'tidal'))

    await toggleSearchProvider(db, 'user_1', 'tidal', true)
    const on = await db.user_settings.get(settingsId('user_1'))
    expect(on?.search_providers).toEqual(SEARCHABLE_PROVIDERS)

    const batch = await pendingBatch(db, 10)
    expect(batch).toHaveLength(1)
    expect(batch[0]).toMatchObject({
      table: 'user_settings',
      data: { search_providers: SEARCHABLE_PROVIDERS },
    })
  })

  it('keeps values it does not know, after the known ones', async () => {
    const at = '2026-09-11T10:00:00.000Z'
    await db.user_settings.put({
      id: settingsId('user_1'),
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 1,
      instruments: [],
      audio_quality: 'standard',
      play_first: 'recordings',
      new_tune_genre: null,
      new_tune_status: 'want_to_learn',
      search_providers: ['tidal', 'future_service'],
    } as never)
    await toggleSearchProvider(db, 'user_1', 'spotify', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.search_providers).toEqual(['tidal', 'spotify', 'future_service'])
    await toggleSearchProvider(db, 'user_1', 'tidal', false)
    expect((await db.user_settings.get(settingsId('user_1')))?.search_providers).toEqual([
      'spotify',
      'future_service',
    ])
  })

  it('never stores other', async () => {
    await toggleSearchProvider(db, 'user_1', 'other', true)
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row?.search_providers).not.toContain('other')
  })

  it('is kept by setInstruments and setAudioQuality', async () => {
    await toggleSearchProvider(db, 'user_1', 'youtube', false)
    const expected = SEARCHABLE_PROVIDERS.filter((p) => p !== 'youtube')
    await setInstruments(db, 'user_1', ['violin'])
    expect((await db.user_settings.get(settingsId('user_1')))?.search_providers).toEqual(expected)
    await setAudioQuality(db, 'user_1', 'high')
    expect((await db.user_settings.get(settingsId('user_1')))?.search_providers).toEqual(expected)
  })

  it('keeps values it does not know through setInstruments and setAudioQuality', async () => {
    const at = '2026-09-11T10:00:00.000Z'
    const stored = ['tidal', 'future_service']
    await db.user_settings.put({
      id: settingsId('user_1'),
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 1,
      instruments: [],
      audio_quality: 'standard',
      play_first: 'recordings',
      new_tune_genre: null,
      new_tune_status: 'want_to_learn',
      search_providers: stored,
    } as never)
    await setInstruments(db, 'user_1', ['violin'])
    expect((await db.user_settings.get(settingsId('user_1')))?.search_providers).toEqual(stored)
    await setAudioQuality(db, 'user_1', 'high')
    expect((await db.user_settings.get(settingsId('user_1')))?.search_providers).toEqual(stored)
    const batch = await pendingBatch(db, 10)
    expect(batch.at(-1)).toMatchObject({ data: { search_providers: stored } })
  })

  it('keeps the choice when instruments toggle', async () => {
    await toggleSearchProvider(db, 'user_1', 'spotify', false)
    await toggleInstrumentSetting(db, 'user_1', 'violin', true)
    expect((await db.user_settings.get(settingsId('user_1')))?.search_providers).not.toContain(
      'spotify',
    )
  })
})

describe('new tune defaults', () => {
  it('start a new settings row with no genre and want to learn', async () => {
    await setInstruments(db, 'user_1', ['violin'])
    expect((await pendingFor(db, 'user_settings', settingsId('user_1')))?.data).toMatchObject({
      new_tune_genre: null,
      new_tune_status: 'want_to_learn',
    })
  })

  it('set a genre and a status and keep the other choices', async () => {
    await setAudioQuality(db, 'user_1', 'high')
    await setNewTuneGenre(db, 'user_1', 'Old-time')
    await setNewTuneStatus(db, 'user_1', 'known')
    const row = await db.user_settings.get(settingsId('user_1'))
    expect(row).toMatchObject({
      audio_quality: 'high',
      new_tune_genre: 'Old-time',
      new_tune_status: 'known',
    })
    expect((await pendingFor(db, 'user_settings', settingsId('user_1')))?.data).toMatchObject({
      new_tune_genre: 'Old-time',
      new_tune_status: 'known',
    })
  })

  it('store a genre as typed, and a blank one as no genre', async () => {
    await setNewTuneGenre(db, 'user_1', 'Cape ')
    expect((await db.user_settings.get(settingsId('user_1')))?.new_tune_genre).toBe('Cape ')
    await setNewTuneGenre(db, 'user_1', '   ')
    expect((await db.user_settings.get(settingsId('user_1')))?.new_tune_genre).toBeNull()
  })

  it('keep a status this client does not know through other settings edits', async () => {
    await putStoredRow({ new_tune_status: 'future_status' })
    await setInstruments(db, 'user_1', ['violin'])
    expect((await pendingFor(db, 'user_settings', settingsId('user_1')))?.data).toMatchObject({
      new_tune_status: 'future_status',
    })
  })
})
