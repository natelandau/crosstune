import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../test/db'
import {
  getKeepOffline,
  getMeta,
  getPullCursor,
  META_KEEP_OFFLINE,
  META_PULL_CURSOR,
  setMeta,
  setPullCursor,
} from './meta'
import { dropPending, enqueue, pendingBatch, pendingFor } from './outbox'
import {
  CrosstuneDb,
  databaseName,
  deleteDatabase,
  openDatabase,
  rowsTable,
  syncTables,
} from './schema'
import { stripOwnership, toChangeData, type LocalList, type LocalTune } from './types'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const tune: LocalTune = {
  id: '018f0000-0000-7000-8000-000000000001',
  created_at: '2026-09-11T00:00:00.000Z',
  updated_at: '2026-09-11T00:00:00.000Z',
  deleted_at: null,
  server_seq: 0,
  title: "Soldier's Joy",
  alternate_titles: [],
  genre: null,
  tune_type: null,
  modes: ['major'],
  composer: null,
  lyrics: null,
  key: 'D',
  tunings: {},
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
      'recording_chunks',
      'recording_files',
      'recording_links',
      'recordings',
      'tunes',
      'user_settings',
      'user_tunes',
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

  it('opens at the current version with the recording tables', async () => {
    const db = openTestDb()
    try {
      await db.open()
      expect(db.tables.map((t) => t.name)).toEqual(
        expect.arrayContaining(['recordings', 'recording_files', 'recording_chunks']),
      )
      expect(db.verno).toBe(5)
    } finally {
      await db.delete()
    }
  })

  const CURRENT_STORES = [
    'list_items',
    'lists',
    'meta',
    'outbox',
    'recording_chunks',
    'recording_files',
    'recording_links',
    'recordings',
    'tunes',
    'user_settings',
    'user_tunes',
  ]

  it('starts a version 4 database over in tune names and keeps local preferences', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v4 = new Dexie(name)
    v4.version(4).stores({
      songs: 'id, title',
      user_songs: 'id, song_id',
      recording_links: 'id, song_id',
      lists: 'id',
      list_items: 'id, list_id, user_song_id',
      user_settings: 'id',
      recordings: 'id, song_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    const filters = { status: 'learning', key: 'D' }
    await v4.table('songs').put({ id: tune.id, title: tune.title })
    await v4.table('user_songs').put({ id: 'us-1', song_id: tune.id, status: 'known' })
    await v4.table('recording_links').put({ id: 'link-1', song_id: tune.id })
    await v4.table('lists').put({ id: 'list-1', name: 'Friday' })
    await v4.table('list_items').put({ id: 'item-1', list_id: 'list-1', user_song_id: 'us-1' })
    await v4.table('user_settings').put({ id: 'settings-1', instruments: ['violin'] })
    await v4.table('recordings').put({ id: 'rec-1', song_id: tune.id })
    await v4
      .table('recording_files')
      .put({ id: 'rec-2', local_state: 'captured', song_id: tune.id })
    await v4.table('recording_chunks').put({ recording_id: 'rec-2', idx: 0, blob: 'chunk' })
    // Version 4's outbox store is '++seq, &[table+row_id]': seq is autoincrement, so omit it on insert.
    await v4.table('outbox').add({
      table: 'user_songs',
      row_id: 'us-1',
      op: 'upsert',
      updated_at: tune.updated_at,
      data: { song_id: tune.id, status: 'known' },
    })
    await v4.table('meta').bulkPut([
      { key: META_PULL_CURSOR, value: 42 },
      { key: 'catalog_filters', value: filters },
      { key: META_KEEP_OFFLINE, value: true },
    ])
    v4.close()

    const upgraded = new CrosstuneDb(name)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(5)
      expect(Array.from(upgraded.backendDB().objectStoreNames).sort()).toEqual(CURRENT_STORES)
      for (const table of upgraded.tables) {
        if (table.name !== 'meta') expect(await table.count(), table.name).toBe(0)
      }
      expect(await getPullCursor(upgraded)).toBe(0)
      expect(await getMeta(upgraded, 'catalog_filters', null)).toEqual(filters)
      expect(await getKeepOffline(upgraded)).toBe(true)
    } finally {
      await upgraded.delete()
    }
  })

  it('starts a version 1 database over with every current store', async () => {
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
    await v1.table('songs').put({ id: tune.id, title: tune.title, tuning: 'AEAE' })
    await v1.table('meta').put({ key: META_PULL_CURSOR, value: 7 })
    v1.close()

    const upgraded = new CrosstuneDb(name)
    try {
      await upgraded.open()
      expect(Array.from(upgraded.backendDB().objectStoreNames).sort()).toEqual(CURRENT_STORES)
      expect(await upgraded.tunes.count()).toBe(0)
      expect(await getPullCursor(upgraded)).toBe(0)
    } finally {
      await upgraded.delete()
    }
  })

  it('deletes a database a newer client wrote and opens it fresh', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v6 = new Dexie(name)
    v6.version(6).stores({ tunes: 'id, title', pieces: 'id', meta: 'key' })
    await v6.table('tunes').put({ id: tune.id, title: tune.title })
    await v6.table('meta').put({ key: META_PULL_CURSOR, value: 42 })
    v6.close()

    const older = new CrosstuneDb(name)
    try {
      // A query auto-opens, the path the app takes.
      expect(await older.tunes.count()).toBe(0)
      expect(older.backendDB().version).toBe(50)
      expect(Array.from(older.backendDB().objectStoreNames).sort()).toEqual(CURRENT_STORES)
      expect(await getPullCursor(older)).toBe(0)
    } finally {
      await older.delete()
    }
  })

  it('does not recreate a database deleted while the newer check is pending', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const pending = new CrosstuneDb(name)
    const opening = pending.open()
    await pending.delete()
    await expect(opening).rejects.toThrow(Dexie.DatabaseClosedError)
    const names = (await indexedDB.databases()).map((info) => info.name)
    expect(names).not.toContain(name)
  })

  it('opens again after a close that came during the newer check', async () => {
    const reopened = openTestDb()
    try {
      const first = reopened.open()
      reopened.close()
      await expect(first).rejects.toThrow(Dexie.DatabaseClosedError)
      await reopened.open()
      expect(reopened.isOpen()).toBe(true)
    } finally {
      await reopened.delete()
    }
  })
})

describe('outbox', () => {
  it('keeps one entry per row, replacing data in place', async () => {
    await enqueue(db, {
      table: 'tunes',
      row_id: tune.id,
      op: 'upsert',
      updated_at: tune.updated_at,
      data: toChangeData(tune),
    })
    await enqueue(db, {
      table: 'tunes',
      row_id: tune.id,
      op: 'upsert',
      updated_at: '2026-09-11T00:00:01.000Z',
      data: toChangeData({ ...tune, title: "Soldier's Joy (D)" }),
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
        updated_at: tune.updated_at,
        data: { name: `L${i}`, position: i, created_at: tune.created_at },
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
      created_at: tune.created_at,
      updated_at: tune.updated_at,
      deleted_at: null,
      server_seq: 0,
    }
    await rowsTable(db, 'lists').put(list)
    expect(await rowsTable(db, 'lists').get(list.id)).toEqual(list)
  })

  it('syncTables lists every synced table', () => {
    expect(syncTables(db).map((t) => t.name)).toEqual([
      'tunes',
      'user_tunes',
      'lists',
      'list_items',
      'recording_links',
      'recordings',
      'user_settings',
    ])
  })
})

describe('row shaping', () => {
  it('strips bookkeeping from change data and ownership from server rows', () => {
    const data = toChangeData(tune)
    expect(Object.keys(data).sort()).toEqual([
      'alternate_titles',
      'composer',
      'created_at',
      'genre',
      'is_crooked',
      'key',
      'lyrics',
      'modes',
      'part_structure',
      'time_signature',
      'title',
      'tune_type',
      'tunings',
    ])
    const local = stripOwnership({ ...tune, owner_user_id: 'u', server_seq: 9 })
    expect('owner_user_id' in local).toBe(false)
    expect(local.server_seq).toBe(9)
  })
})
