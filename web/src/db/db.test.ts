import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import openapi from '../../../api/openapi.json'
import { openTestDb } from '../test/db'
import { createFakeApi } from '../test/fakeApi'
import { linkRow, playEventRow, recordingRow, scanFile, scanRow, scanViewRow } from '../test/rows'
import { transfersSettled } from '../test/transfers'
import { createSyncEngine } from '../sync/engine'
import {
  getKeepOffline,
  getMeta,
  getPullCursor,
  META_KEEP_OFFLINE,
  META_PULL_CURSOR,
  META_SCAN_INVERT,
  setMeta,
  setPullCursor,
} from './meta'
import { dropPending, enqueue, pendingBatch, pendingFor } from './outbox'
import {
  CrosstuneDb,
  databaseName,
  deleteDatabase,
  eventTables,
  openDatabase,
  repull,
  rowsTable,
  syncTables,
} from './schema'
import { stripOwnership, toChangeData, type LocalList, type LocalTune } from './types'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
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
  it('opens with every synced and event table plus outbox and meta', async () => {
    await db.open()
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'list_items',
      'lists',
      'meta',
      'outbox',
      'play_events',
      'practice_sessions',
      'recording_chunks',
      'recording_files',
      'recording_links',
      'recording_loops',
      'recordings',
      'scan_files',
      'scan_views',
      'scans',
      'status_changes',
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
    await db.open()
    expect(db.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['recordings', 'recording_files', 'recording_chunks']),
    )
    expect(db.verno).toBe(15)
  })

  const CURRENT_STORES = [
    'list_items',
    'lists',
    'meta',
    'outbox',
    'play_events',
    'practice_sessions',
    'recording_chunks',
    'recording_files',
    'recording_links',
    'recording_loops',
    'recordings',
    'scan_files',
    'scan_views',
    'scans',
    'status_changes',
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
      expect(upgraded.verno).toBe(15)
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

  it('keeps unsent changes and unuploaded recordings when a version 6 database opens', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v6 = new Dexie(name)
    v6.version(6).stores({
      tunes: 'id, title',
      user_tunes: 'id, tune_id',
      recording_links: 'id, tune_id',
      lists: 'id',
      list_items: 'id, list_id, user_tune_id',
      user_settings: 'id',
      recordings: 'id, tune_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    await v6
      .table('recordings')
      .bulkPut([recordingRow('rec-captured'), recordingRow('rec-uploading')])
    await v6.table('recording_files').bulkPut([
      { id: 'rec-captured', local_state: 'captured' },
      { id: 'rec-uploading', local_state: 'uploading' },
    ])
    await v6.table('recording_chunks').bulkPut([
      { recording_id: 'rec-uploading', idx: 0, blob: 'chunk-0' },
      { recording_id: 'rec-uploading', idx: 1, blob: 'chunk-1' },
    ])
    for (const [table, rowId] of [
      ['recordings', 'rec-captured'],
      ['tunes', tune.id],
    ]) {
      await v6.table('outbox').add({
        table,
        row_id: rowId,
        op: 'upsert',
        updated_at: tune.updated_at,
        data: {},
      })
    }
    await v6.table('meta').put({ key: META_PULL_CURSOR, value: 42 })
    v6.close()

    const opened = new CrosstuneDb(name)
    try {
      await opened.open()
      expect((await opened.recordings.toArray()).map((r) => r.id).sort()).toEqual([
        'rec-captured',
        'rec-uploading',
      ])
      expect((await opened.recording_files.toArray()).map((f) => f.id).sort()).toEqual([
        'rec-captured',
        'rec-uploading',
      ])
      expect(
        await opened.recording_chunks.where('recording_id').equals('rec-uploading').count(),
      ).toBe(2)
      expect((await opened.outbox.orderBy('seq').toArray()).map((e) => e.row_id)).toEqual([
        'rec-captured',
        tune.id,
      ])
      expect(await getPullCursor(opened)).toBe(0)
      expect(await opened.recording_loops.count()).toBe(0)
      expect(opened.verno).toBe(15)
    } finally {
      await opened.delete()
    }
  })

  it('drops the label from stored and queued links when a version 7 database opens', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v7 = new Dexie(name)
    v7.version(7).stores({
      tunes: 'id, title',
      user_tunes: 'id, tune_id',
      recording_links: 'id, tune_id',
      lists: 'id',
      list_items: 'id, list_id, user_tune_id',
      user_settings: 'id',
      recordings: 'id, tune_id',
      recording_loops: 'id, recording_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    const link = { ...linkRow('link-1', tune.id), label: 'slow version' }
    await v7.table('recording_links').put(link)
    await v7.table('outbox').bulkAdd([
      {
        table: 'recording_links',
        row_id: link.id,
        op: 'upsert',
        updated_at: link.updated_at,
        data: toChangeData(link, 'recording_links'),
      },
      {
        table: 'recordings',
        row_id: 'rec-1',
        op: 'upsert',
        updated_at: link.updated_at,
        data: { label: 'A part' },
      },
    ])
    await v7.table('meta').put({ key: META_PULL_CURSOR, value: 42 })
    v7.close()

    const opened = new CrosstuneDb(name)
    try {
      await opened.open()
      expect(await opened.recording_links.get(link.id)).toEqual(linkRow('link-1', tune.id))
      const [linkChange, recordingChange] = await opened.outbox.orderBy('seq').toArray()
      expect(linkChange?.data).toEqual(toChangeData(linkRow('link-1', tune.id), 'recording_links'))
      expect(recordingChange?.data).toEqual({ label: 'A part', origin: 'own', origin_url: null })
      expect(await getPullCursor(opened)).toBe(0)
    } finally {
      await opened.delete()
    }
  })

  it('version 11 resets the pull cursor', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v10 = new Dexie(name)
    v10.version(10).stores({
      tunes: 'id, title',
      user_tunes: 'id, tune_id',
      recording_links: 'id, tune_id',
      lists: 'id',
      list_items: 'id, list_id, user_tune_id',
      user_settings: 'id',
      recordings: 'id, tune_id, state',
      recording_loops: 'id, recording_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    await v10.table('outbox').add({
      table: 'tunes',
      row_id: tune.id,
      op: 'upsert',
      updated_at: tune.updated_at,
      data: {},
    })
    await v10.table('meta').put({ key: META_PULL_CURSOR, value: 42 })
    v10.close()

    const opened = new CrosstuneDb(name)
    try {
      await opened.open()
      expect(await getPullCursor(opened)).toBe(0)
      expect((await opened.outbox.toArray()).map((e) => e.row_id)).toEqual([tune.id])
      expect(await opened.scans.count()).toBe(0)
    } finally {
      await opened.delete()
    }
  })

  it('version 12 splits a recording date into when it was added and when it was played', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v11 = new Dexie(name)
    v11.version(11).stores({
      tunes: 'id, title',
      user_tunes: 'id, tune_id',
      recording_links: 'id, tune_id',
      lists: 'id',
      list_items: 'id, list_id, user_tune_id',
      user_settings: 'id',
      recordings: 'id, tune_id, state',
      recording_loops: 'id, recording_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
      notation_pages: 'id, tune_id, state',
      notation_files: 'id, origin',
    })
    // A version 11 row holds its one date as recorded_at and has no precision.
    const legacy = (id: string, source: string, recordedAt: string) => {
      const row: Record<string, unknown> = recordingRow(id, { source, recorded_at: recordedAt })
      delete row.added_at
      delete row.recorded_precision
      return row as { id: string; updated_at: string }
    }
    const rows = [
      legacy('take', 'microphone', '2026-01-01T12:00:00.000Z'),
      legacy('upload', 'upload', '2026-02-01T12:00:00.000Z'),
      legacy('import', 'import', '2026-03-01T12:00:00.000Z'),
    ]
    await v11.table('recordings').bulkPut(rows)
    await v11.table('outbox').bulkAdd([
      ...rows.map((row) => ({
        table: 'recordings',
        row_id: row.id,
        op: 'upsert',
        updated_at: row.updated_at,
        data: { ...row },
      })),
      {
        table: 'recordings',
        row_id: 'gone',
        op: 'delete',
        updated_at: '2026-04-01T00:00:00.000Z',
        data: null,
      },
    ])
    v11.close()

    const opened = new CrosstuneDb(name)
    try {
      await opened.open()
      const expected = {
        take: {
          added_at: '2026-01-01T12:00:00.000Z',
          recorded_at: '2026-01-01T12:00:00.000Z',
          recorded_precision: 'time',
        },
        upload: {
          added_at: '2026-02-01T12:00:00.000Z',
          recorded_at: null,
          recorded_precision: null,
        },
        import: {
          added_at: '2026-03-01T12:00:00.000Z',
          recorded_at: null,
          recorded_precision: null,
        },
      }
      for (const [id, dates] of Object.entries(expected)) {
        expect(await opened.recordings.get(id)).toMatchObject(dates)
        expect((await pendingFor(opened, 'recordings', id))?.data).toMatchObject(dates)
      }
      expect((await pendingFor(opened, 'recordings', 'gone'))?.data).toBeNull()
    } finally {
      await opened.delete()
    }
  })

  it('version 12 leaves a recording already in the new shape alone', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v11 = new Dexie(name)
    v11.version(11).stores({
      tunes: 'id, title',
      user_tunes: 'id, tune_id',
      recording_links: 'id, tune_id',
      lists: 'id',
      list_items: 'id, list_id, user_tune_id',
      user_settings: 'id',
      recordings: 'id, tune_id, state',
      recording_loops: 'id, recording_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
      notation_pages: 'id, tune_id, state',
      notation_files: 'id, origin',
    })
    const dated = recordingRow('import', {
      source: 'import',
      added_at: '2026-03-01T12:00:00.000Z',
      recorded_at: '1937-01-01T00:00:00.000Z',
      recorded_precision: 'year',
    })
    const queued = recordingRow('upload', {
      source: 'upload',
      added_at: '2026-02-01T12:00:00.000Z',
      recorded_at: '1998-05-01T00:00:00.000Z',
      recorded_precision: 'month',
    })
    await v11.table('recordings').bulkPut([dated, queued])
    await v11.table('outbox').add({
      table: 'recordings',
      row_id: queued.id,
      op: 'upsert',
      updated_at: queued.updated_at,
      data: toChangeData(queued, 'recordings'),
    })
    v11.close()

    const opened = new CrosstuneDb(name)
    try {
      await opened.open()
      expect(await opened.recordings.get(dated.id)).toEqual(dated)
      expect(await opened.recordings.get(queued.id)).toEqual(queued)
      expect((await pendingFor(opened, 'recordings', queued.id))?.data).toEqual(
        toChangeData(queued, 'recordings'),
      )
    } finally {
      await opened.delete()
    }
  })

  it('reads stored and queued recordings as own when a version 9 database opens', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v9 = new Dexie(name)
    v9.version(9).stores({
      tunes: 'id, title',
      user_tunes: 'id, tune_id',
      recording_links: 'id, tune_id',
      lists: 'id',
      list_items: 'id, list_id, user_tune_id',
      user_settings: 'id',
      recordings: 'id, tune_id, state',
      recording_loops: 'id, recording_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    const { origin, origin_url, ...legacy } = recordingRow('rec-1')
    expect([origin, origin_url]).toEqual(['own', null])
    await v9.table('recordings').put(legacy)
    await v9.table('outbox').bulkAdd([
      {
        table: 'recordings',
        row_id: 'rec-1',
        op: 'upsert',
        updated_at: legacy.updated_at,
        data: legacy,
      },
      {
        table: 'tunes',
        row_id: 'tune-1',
        op: 'upsert',
        updated_at: legacy.updated_at,
        data: { title: 'Untouched' },
      },
    ])
    v9.close()

    const opened = new CrosstuneDb(name)
    try {
      await opened.open()
      expect(await opened.recordings.get('rec-1')).toMatchObject({
        origin: 'own',
        origin_url: null,
      })
      const [recordingChange, tuneChange] = await opened.outbox.orderBy('seq').toArray()
      expect(recordingChange?.data).toMatchObject({ origin: 'own', origin_url: null })
      expect(tuneChange?.data).toEqual({ title: 'Untouched' })
    } finally {
      await opened.delete()
    }
  })

  it('a v12 database keeps rows and outbox and gains the event stores', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v12 = new Dexie(name)
    v12.version(12).stores({
      tunes: 'id, title',
      user_tunes: 'id, tune_id',
      recording_links: 'id, tune_id',
      lists: 'id',
      list_items: 'id, list_id, user_tune_id',
      user_settings: 'id',
      recordings: 'id, tune_id, state',
      recording_loops: 'id, recording_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      notation_pages: 'id, tune_id, state',
      notation_files: 'id, origin',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    await v12.table('tunes').put(tune)
    await v12.table('outbox').add({
      table: 'tunes',
      row_id: tune.id,
      op: 'upsert',
      updated_at: tune.updated_at,
      data: toChangeData(tune, 'tunes'),
    })
    await v12.table('meta').put({ key: META_PULL_CURSOR, value: 42 })
    v12.close()

    const opened = new CrosstuneDb(name)
    try {
      await opened.open()
      expect(await opened.tunes.get(tune.id)).toEqual(tune)
      expect((await opened.outbox.toArray()).map((e) => e.row_id)).toEqual([tune.id])
      expect(await getPullCursor(opened)).toBe(42)
      const backend = opened.backendDB()
      expect(Array.from(backend.objectStoreNames).sort()).toEqual(CURRENT_STORES)
      const tx = backend.transaction(['play_events', 'practice_sessions', 'status_changes'])
      expect(Array.from(tx.objectStore('play_events').indexNames)).toEqual(['started_at'])
      expect(Array.from(tx.objectStore('practice_sessions').indexNames)).toEqual(['started_at'])
      expect(Array.from(tx.objectStore('status_changes').indexNames)).toEqual(['changed_at'])
    } finally {
      await opened.delete()
    }
  })

  it('moves notation pages, their files, queued changes, and invert to scans at v14', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v13 = new Dexie(name)
    v13.version(13).stores({
      tunes: 'id, title',
      user_tunes: 'id, tune_id',
      recording_links: 'id, tune_id',
      lists: 'id',
      list_items: 'id, list_id, user_tune_id',
      user_settings: 'id',
      recordings: 'id, tune_id, state',
      recording_loops: 'id, recording_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      notation_pages: 'id, tune_id, state',
      notation_files: 'id, origin',
      play_events: 'id, started_at',
      practice_sessions: 'id, started_at',
      status_changes: 'id, changed_at',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    const pending = scanRow('scan-1', tune.id, {
      server_seq: 0,
      state: 'pending_upload',
      file_bytes: null,
    })
    const file = scanFile('scan-1', new Blob(['jpeg'], { type: 'image/jpeg' }), {
      origin: 'captured',
    })
    await v13.table('tunes').put(tune)
    await v13.table('notation_pages').put(pending)
    await v13.table('notation_files').put(file)
    await v13.table('outbox').bulkAdd([
      {
        table: 'tunes',
        row_id: tune.id,
        op: 'upsert',
        updated_at: tune.updated_at,
        data: toChangeData(tune, 'tunes'),
      },
      {
        table: 'notation_pages',
        row_id: pending.id,
        op: 'upsert',
        updated_at: pending.updated_at,
        data: toChangeData(pending, 'scans'),
      },
    ])
    await v13.table('meta').bulkPut([
      { key: 'notation_invert', value: true },
      { key: META_PULL_CURSOR, value: 42 },
    ])
    v13.close()

    const opened = new CrosstuneDb(name)
    try {
      await opened.open()
      expect(Array.from(opened.backendDB().objectStoreNames).sort()).toEqual(CURRENT_STORES)
      expect(await opened.scans.get(pending.id)).toEqual(pending)
      expect(await opened.scans.where('state').equals('pending_upload').primaryKeys()).toEqual([
        pending.id,
      ])
      const moved = await opened.scan_files.where('origin').equals('captured').toArray()
      expect(moved.map((f) => f.id)).toEqual([file.id])
      expect(await moved[0]?.blob.text()).toBe('jpeg')
      const queued = await opened.outbox.orderBy('seq').toArray()
      expect(queued.map((e) => [e.seq, e.table, e.row_id])).toEqual([
        [1, 'tunes', tune.id],
        [2, 'scans', pending.id],
      ])
      expect(await pendingFor(opened, 'scans', pending.id)).toMatchObject({ op: 'upsert' })
      expect(await getMeta(opened, META_SCAN_INVERT, false)).toBe(true)
      expect(await opened.meta.get('notation_invert')).toBeUndefined()
      expect(await getPullCursor(opened)).toBe(42)

      // The moved scan still pushes and uploads.
      const fake = createFakeApi()
      const engine = createSyncEngine({ db: opened, api: fake.api, isOnline: () => true })
      await engine.sync()
      await transfersSettled(engine)
      engine.stop()
      expect(fake.pushes.flat().map((c) => c.table)).toContain('scans')
      expect(await fake.objects.get(`${pending.id}/scan.jpg`)?.text()).toBe('jpeg')
      expect(await opened.scan_files.get(pending.id)).toMatchObject({ origin: 'downloaded' })
    } finally {
      await opened.delete()
    }
  })

  it('a v14 database keeps rows, outbox, and events and gains the scan views store', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v14 = new Dexie(name)
    v14.version(14).stores({
      tunes: 'id, title',
      user_tunes: 'id, tune_id',
      recording_links: 'id, tune_id',
      lists: 'id',
      list_items: 'id, list_id, user_tune_id',
      user_settings: 'id',
      recordings: 'id, tune_id, state',
      recording_loops: 'id, recording_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
      scans: 'id, tune_id, state',
      scan_files: 'id, origin',
      play_events: 'id, started_at',
      practice_sessions: 'id, started_at',
      status_changes: 'id, changed_at',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    const play = playEventRow('play-1')
    await v14.table('tunes').put(tune)
    await v14.table('play_events').put(play)
    await v14.table('outbox').add({
      table: 'play_events',
      row_id: play.id,
      op: 'upsert',
      updated_at: play.created_at,
      data: toChangeData(play, 'play_events'),
    })
    await v14.table('meta').put({ key: META_PULL_CURSOR, value: 42 })
    v14.close()

    const opened = new CrosstuneDb(name)
    try {
      await opened.open()
      expect(await opened.tunes.get(tune.id)).toEqual(tune)
      expect(await opened.play_events.get(play.id)).toEqual(play)
      expect((await opened.outbox.toArray()).map((e) => [e.table, e.row_id])).toEqual([
        ['play_events', play.id],
      ])
      expect(await getPullCursor(opened)).toBe(42)
      const backend = opened.backendDB()
      expect(Array.from(backend.objectStoreNames).sort()).toEqual(CURRENT_STORES)
      const tx = backend.transaction(['scan_views'])
      expect(Array.from(tx.objectStore('scan_views').indexNames)).toEqual(['started_at'])
    } finally {
      await opened.delete()
    }
  })

  it('repull forgets only the pull cursor', async () => {
    await db.tunes.put(tune)
    await enqueue(db, {
      table: 'tunes',
      row_id: tune.id,
      op: 'upsert',
      updated_at: tune.updated_at,
      data: toChangeData(tune, 'tunes'),
    })
    await setPullCursor(db, 9)
    await setMeta(db, META_KEEP_OFFLINE, true)

    await db.transaction('rw', db.meta, (tx) => repull(tx))

    expect(await getPullCursor(db)).toBe(0)
    expect(await getKeepOffline(db)).toBe(true)
    expect(await db.tunes.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)
  })

  it('deletes a database a newer client wrote and opens it fresh', async () => {
    const name = `crosstune-test-${crypto.randomUUID()}`
    const v16 = new Dexie(name)
    v16.version(16).stores({ tunes: 'id, title', pieces: 'id', meta: 'key' })
    await v16.table('tunes').put({ id: tune.id, title: tune.title })
    await v16.table('meta').put({ key: META_PULL_CURSOR, value: 42 })
    v16.close()

    const older = new CrosstuneDb(name)
    try {
      // A query auto-opens, the path the app takes.
      expect(await older.tunes.count()).toBe(0)
      expect(older.backendDB().version).toBe(150)
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
    const first = reopened.open()
    reopened.close()
    await expect(first).rejects.toThrow(Dexie.DatabaseClosedError)
    await reopened.open()
    expect(reopened.isOpen()).toBe(true)
  })

  it('rejects queries that auto-opened during the newer check on close', async () => {
    const closing = openTestDb()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const opening = closing.open()
      const query = closing.tunes.count()
      const transaction = closing.transaction('r', closing.tunes, () => closing.tunes.count())
      closing.close()
      await expect(opening).rejects.toThrow(Dexie.DatabaseClosedError)
      const hung = new Promise((resolve) => {
        timer = setTimeout(() => resolve('hung'), 1000)
      })
      await expect(Promise.race([query, hung])).rejects.toThrow(Dexie.DatabaseClosedError)
      await expect(Promise.race([transaction, hung])).rejects.toThrow(Dexie.DatabaseClosedError)
    } finally {
      clearTimeout(timer)
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
      data: toChangeData(tune, 'tunes'),
    })
    await enqueue(db, {
      table: 'tunes',
      row_id: tune.id,
      op: 'upsert',
      updated_at: '2026-09-11T00:00:01.000Z',
      data: toChangeData({ ...tune, title: "Soldier's Joy (D)" }, 'tunes'),
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

  it('eventTables lists every event store', () => {
    expect(eventTables(db).map((t) => t.name)).toEqual([
      'play_events',
      'practice_sessions',
      'scan_views',
      'status_changes',
    ])
  })

  it('syncTables lists every synced table', () => {
    expect(syncTables(db).map((t) => t.name)).toEqual([
      'tunes',
      'user_tunes',
      'lists',
      'list_items',
      'recording_links',
      'recordings',
      'scans',
      'recording_loops',
      'user_settings',
    ])
  })
})

describe('row shaping', () => {
  it('strips bookkeeping from change data and ownership from server rows', () => {
    const data = toChangeData(tune, 'tunes')
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

  it('recording change data carries only fields RecordingData accepts', () => {
    const allowed = new Set(Object.keys(openapi.components.schemas.RecordingData.properties))
    const row = recordingRow('r1', {
      state: 'ready',
      duration_ms: 4000,
      playback_mime: 'audio/mp4',
      playback_bytes: 512,
      error: null,
      source_duration_ms: 4200,
      playback_start_ms: 0,
      playback_end_ms: 4000,
      playback_rev: 'abc12345',
      peaks_rev: 'def67890',
    })
    const data = toChangeData(row, 'recordings')
    for (const key of Object.keys(data)) expect(allowed).toContain(key)
  })

  it('scan view change data carries exactly the fields ScanViewData accepts', () => {
    const allowed = Object.keys(openapi.components.schemas.ScanViewData.properties).sort()
    const data = toChangeData(scanViewRow('view-1', { server_seq: 3 }), 'scan_views')
    expect(Object.keys(data).sort()).toEqual(allowed)
  })

  it('scan change data leaves out the server-owned file columns', () => {
    const data = toChangeData(
      scanRow('scan-1', 'tune-1', { state: 'pending_upload', file_bytes: null }),
      'scans',
    )
    expect(Object.keys(data).sort()).toEqual([
      'created_at',
      'height',
      'position',
      'tune_id',
      'width',
    ])
  })
})
