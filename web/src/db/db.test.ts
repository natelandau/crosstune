import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openTestDb } from '../test/db'
import { getMeta, getPullCursor, setMeta, setPullCursor } from './meta'
import { dropPending, enqueue, pendingBatch, pendingFor } from './outbox'
import {
  type CrosstuneDb,
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
  feel: null,
  lyrics: null,
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
      'banjo_tuning',
      'created_at',
      'feel',
      'genre',
      'is_crooked',
      'key',
      'lyrics',
      'mode',
      'part_structure',
      'time_signature',
      'title',
      'violin_tuning',
    ])
    const local = stripOwnership({ ...tune, owner_user_id: 'u', server_seq: 9 })
    expect('owner_user_id' in local).toBe(false)
    expect(local.server_seq).toBe(9)
  })
})
