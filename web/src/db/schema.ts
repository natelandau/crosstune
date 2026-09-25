import Dexie, { type EntityTable, type Table, type Transaction } from 'dexie'
import { META_PULL_CURSOR } from './meta'
import type { RecordingChunk, RecordingFile } from './recordings'
import {
  TABLE_NAMES,
  type LocalList,
  type LocalListItem,
  type LocalRecording,
  type LocalRecordingLink,
  type LocalRows,
  type LocalTune,
  type LocalUserSettings,
  type LocalUserTune,
  type MetaEntry,
  type OutboxEntry,
  type TableName,
} from './types'

// Every store the server refills, plus what could only be pushed or uploaded in an older shape.
const STARTED_OVER = [...TABLE_NAMES, 'recording_files', 'recording_chunks', 'outbox'] as const

/**
 * Empty a database from before version 5 and reset its pull cursor, so the next sync pulls
 * every row again in this version's shape. Unsynced edits and unuploaded recordings are
 * dropped. Every other meta entry is a local preference and stays.
 */
async function startOver(tx: Transaction): Promise<void> {
  await Promise.all(STARTED_OVER.map((store) => tx.table(store).clear()))
  await tx.table('meta').delete(META_PULL_CURSOR)
}

/**
 * Delete the named database when a newer client wrote it, as after a web rollback. Dexie opens
 * a newer database as it is, so this client would read rows in a shape it does not know and
 * keep a pull cursor that never refills its own stores. Unsynced edits are dropped.
 */
async function deleteIfNewer(name: string, verno: number): Promise<void> {
  const factory = Dexie.dependencies.indexedDB
  // Firefox before 126 has no databases() and opens a newer database as it is.
  if (!('databases' in factory)) return
  const stored = (await factory.databases()).find((info) => info.name === name)
  // Dexie stores version n as native version 10n, plus one when it patches a schema in place.
  if (stored?.version !== undefined && Math.floor(stored.version / 10) > verno) {
    await Dexie.delete(name)
  }
}

export class CrosstuneDb extends Dexie {
  // EntityTable<T, K> makes the key property K optional on insert, Dexie's convention for
  // autoincrement keys. These tables use app-supplied ids, so Table<T, string> keeps inserts
  // requiring the full row instead of type-checking a runtime failure.
  tunes!: Table<LocalTune, string>
  user_tunes!: Table<LocalUserTune, string>
  recording_links!: Table<LocalRecordingLink, string>
  lists!: Table<LocalList, string>
  list_items!: Table<LocalListItem, string>
  user_settings!: Table<LocalUserSettings, string>
  recordings!: Table<LocalRecording, string>
  recording_files!: Table<RecordingFile, string>
  recording_chunks!: Table<RecordingChunk, [string, number]>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  meta!: Table<MetaEntry, string>
  private newerChecked: Promise<void> | undefined
  private closes = 0
  declare private readonly _state: {
    readonly isBeingOpened: boolean
    readonly dbReadyResolve: () => void
  }

  constructor(name: string) {
    super(name)
    // Only keys used in where() clauses are indexed. Null is not indexable, so
    // deleted_at and archived_at are filtered in memory.
    this.version(5)
      .stores({
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
        songs: null,
        user_songs: null,
      })
      .upgrade(startOver)
  }

  // Dexie's auto-open on the first query calls this method too.
  override open() {
    // A failed check must not keep the app from opening its database.
    this.newerChecked ??= deleteIfNewer(this.name, this.verno).catch(() => undefined)
    const closesAtOpen = this.closes
    return Dexie.Promise.resolve(this.newerChecked).then(() => {
      // A close or delete during the check wins, or this open would recreate the database.
      if (this.closes !== closesAtOpen) throw new Dexie.DatabaseClosedError()
      return super.open()
    })
  }

  // delete() closes through this method, so it also cancels a pending open.
  override close(options: { disableAutoOpen: boolean } = { disableAutoOpen: true }) {
    // Dexie closes with disableAutoOpen false to reopen itself; that must not cancel the open.
    if (!options.disableAutoOpen) return super.close(options)
    this.closes += 1
    // A query that auto-opened during the newer check waits on a ready promise that Dexie's
    // close replaces unsettled. Settling it makes that query reject as closed instead of hang.
    // Both fields are Dexie 4 private state; re-check them against _close in dexie.mjs when
    // upgrading Dexie, since the test would not catch a renamed isBeingOpened.
    const settleWaiters = this._state.isBeingOpened ? undefined : this._state.dbReadyResolve
    super.close(options)
    settleWaiters?.()
  }
}

export function databaseName(userId: string): string {
  return `crosstune-${userId}`
}

export function openDatabase(userId: string): CrosstuneDb {
  return new CrosstuneDb(databaseName(userId))
}

export async function deleteDatabase(userId: string): Promise<void> {
  await Dexie.delete(databaseName(userId))
}

type RowsTables = { [K in TableName]: Table<LocalRows[K], string> }

export function rowsTable<T extends TableName>(
  db: CrosstuneDb,
  name: T,
): Table<LocalRows[T], string> {
  // A mapped type indexed by T resolves to Table<LocalRows[T]>, which db[name] does not.
  const tables: RowsTables = {
    tunes: db.tunes,
    user_tunes: db.user_tunes,
    lists: db.lists,
    list_items: db.list_items,
    recording_links: db.recording_links,
    recordings: db.recordings,
    user_settings: db.user_settings,
  }
  return tables[name]
}

export function syncTables(db: CrosstuneDb): Table[] {
  return TABLE_NAMES.map((name) => db[name])
}
