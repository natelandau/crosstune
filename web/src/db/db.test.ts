import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../test/db'
import { getMeta, getPullCursor, setMeta, setPullCursor } from './meta'
import { dropPending, enqueue, pendingBatch, pendingFor } from './outbox'
import {
  CrosstuneDb,
  databaseName,
  deleteDatabase,
  openDatabase,
  rowsTable,
  syncTables,
} from './schema'
import { stripOwnership, toChangeData, type LocalList, type LocalSong } from './types'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const song: LocalSong = {
  id: '018f0000-0000-7000-8000-000000000001',
  created_at: '2026-09-11T00:00:00.000Z',
  updated_at: '2026-09-11T00:00:00.000Z',
  deleted_at: null,
  server_seq: 0,
  title: "Soldier's Joy",
  alternate_titles: [],
  genre: null,
  feel: null,
  has_lyrics: null,
  key: 'D',
  mode: 'major',
  violin_tuning: null,
  banjo_tuning: null,
  part_structure: 'AABB',
  time_signature: '4/4',
  is_crooked: false,
}

describe('schema', () => {
  it('opens with every synced table plus outbox and meta', async () => {
    await db.open()
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'list_items',
      'lists',
      'meta',
      'outbox',
      'recording_links',
      'songs',
      'user_settings',
      'user_songs',
    ])
  })

  it('names the database after the user and deletes it on request', async () => {
    const other = openDatabase('user_abc')
    await other.open()
    other.close()
    expect(databaseName('user_abc')).toBe('crosstune-user_abc')
    await deleteDatabase('user_abc')
    expect(await Dexie.exists('crosstune-user_abc')).toBe(false)
  })

  it('upgrades a version 1 database by giving each instrument its own tuning', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({
      songs: 'id, title',
      user_songs: 'id, song_id',
      recording_links: 'id, song_id',
      lists: 'id',
      list_items: 'id, list_id, user_song_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    const legacy: Record<string, unknown> = { ...song, tuning: 'AEAE' }
    delete legacy.violin_tuning
    delete legacy.banjo_tuning
    await v1.table('songs').put(legacy)
    const legacyChangeData: Record<string, unknown> = { ...toChangeData(song), tuning: 'AEAE' }
    delete legacyChangeData.violin_tuning
    delete legacyChangeData.banjo_tuning
    // Version 1's outbox store is '++seq, &[table+row_id]': seq is autoincrement, so omit it on insert.
    await v1.table('outbox').add({
      table: 'songs',
      row_id: song.id,
      op: 'upsert',
      updated_at: song.updated_at,
      data: legacyChangeData,
    })
    v1.close()

    const upgraded = new CrosstuneDb(name)
    try {
      const row = await upgraded.songs.get(song.id)
      expect(row).toMatchObject({ violin_tuning: 'AEAE', banjo_tuning: null })
      expect(row !== undefined && 'tuning' in row).toBe(false)
      expect(upgraded.tables.map((t) => t.name)).toContain('user_settings')
      const entry = await pendingFor(upgraded, 'songs', song.id)
      expect(entry?.data).toMatchObject({ violin_tuning: 'AEAE', banjo_tuning: null })
      expect(entry?.data && 'tuning' in entry.data).toBe(false)
    } finally {
      await upgraded.delete()
    }
  })
})

describe('outbox', () => {
  it('keeps one entry per row, replacing data in place', async () => {
    await enqueue(db, {
      table: 'songs',
      row_id: song.id,
      op: 'upsert',
      updated_at: song.updated_at,
      data: toChangeData(song),
    })
    await enqueue(db, {
      table: 'songs',
      row_id: song.id,
      op: 'upsert',
      updated_at: '2026-09-11T00:00:01.000Z',
      data: toChangeData({ ...song, title: "Soldier's Joy (D)" }),
    })
    const entries = await pendingBatch(db)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.data?.title).toBe("Soldier's Joy (D)")
    expect(entries[0]?.updated_at).toBe('2026-09-11T00:00:01.000Z')
  })

  it('orders entries by first enqueue and honors the batch limit', async () => {
    for (let i = 0; i < 3; i++) {
      await enqueue(db, {
        table: 'lists',
        row_id: `list-${i}`,
        op: 'upsert',
        updated_at: song.updated_at,
        data: { name: `L${i}`, position: i, created_at: song.created_at },
      })
    }
    const two = await pendingBatch(db, 2)
    expect(two.map((e) => e.row_id)).toEqual(['list-0', 'list-1'])
    expect(await pendingFor(db, 'lists', 'list-2')).toBeDefined()
    await dropPending(db, 'lists', 'list-2')
    expect(await pendingFor(db, 'lists', 'list-2')).toBeUndefined()
  })
})

describe('meta', () => {
  it('returns the fallback until a value is set', async () => {
    expect(await getMeta(db, 'x', 'fallback')).toBe('fallback')
    await setMeta(db, 'x', { a: 1 })
    expect(await getMeta(db, 'x', null)).toEqual({ a: 1 })
    expect(await getPullCursor(db)).toBe(0)
    await setPullCursor(db, 42)
    expect(await getPullCursor(db)).toBe(42)
  })
})

describe('table helpers', () => {
  it('rowsTable resolves the right table for a name', async () => {
    const list: LocalList = {
      id: 'list-1',
      name: 'Session set',
      position: 0,
      created_at: song.created_at,
      updated_at: song.updated_at,
      deleted_at: null,
      server_seq: 0,
    }
    await rowsTable(db, 'lists').put(list)
    expect(await rowsTable(db, 'lists').get(list.id)).toEqual(list)
  })

  it('syncTables lists every synced table', () => {
    expect(syncTables(db).map((t) => t.name)).toEqual([
      'songs',
      'user_songs',
      'lists',
      'list_items',
      'recording_links',
      'user_settings',
    ])
  })
})

describe('row shaping', () => {
  it('strips bookkeeping from change data and ownership from server rows', () => {
    const data = toChangeData(song)
    expect(Object.keys(data).sort()).toEqual([
      'alternate_titles',
      'banjo_tuning',
      'created_at',
      'feel',
      'genre',
      'has_lyrics',
      'is_crooked',
      'key',
      'mode',
      'part_structure',
      'time_signature',
      'title',
      'violin_tuning',
    ])
    const local = stripOwnership({ ...song, owner_user_id: 'u', server_seq: 9 })
    expect('owner_user_id' in local).toBe(false)
    expect(local.server_seq).toBe(9)
  })
})
