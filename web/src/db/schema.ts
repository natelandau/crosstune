import Dexie, { type EntityTable, type Table, type Transaction } from 'dexie'
import { META_PULL_CURSOR, META_SCAN_INVERT } from './meta'
import type { RecordingChunk, RecordingFile } from './recordings'
import type { ScanFile } from './scans'
import {
  TABLE_NAMES,
  type LocalList,
  type LocalListItem,
  type LocalPlayEvent,
  type LocalPracticeSession,
  type LocalRecording,
  type LocalRecordingLoop,
  type LocalRecordingLink,
  type LocalRows,
  type LocalScan,
  type LocalScanView,
  type LocalStatusChange,
  type LocalTune,
  type LocalUserSettings,
  type LocalUserTune,
  type MetaEntry,
  type OutboxEntry,
  type SyncTableName,
} from './types'

// The invert setting's key before version 14.
const LEGACY_INVERT_KEY = 'notation_invert'

// Every store the server refilled as of version 6, plus what could only be pushed or uploaded
// in an older shape. A fixed list: the upgrade transaction holds only stores that version has.
const STARTED_OVER = [
  'tunes',
  'user_tunes',
  'lists',
  'list_items',
  'recording_links',
  'recordings',
  'user_settings',
  'recording_files',
  'recording_chunks',
  'outbox',
] as const

/**
 * Make the next pull fetch every row again. Queued changes stay and win over pulled rows that
 * are older, as they always do.
 */
export async function repull(tx: Transaction): Promise<void> {
  await tx.table('meta').delete(META_PULL_CURSOR)
}

/**
 * Empty a database from before version 6 and reset its pull cursor, so the next sync pulls
 * every row again in this version's shape. Unsynced edits and unuploaded recordings are
 * dropped. Every other meta entry is a local preference and stays.
 *
 * The upgrader of versions 5 and 6 only. From version 7 each version's upgrader reshapes rows in place,
 * rewrites queued changes' data into the new shape, keeps every unuploaded recording and its
 * chunks, and calls repull when a new field holds values only the server knows.
 */
async function startOver(tx: Transaction): Promise<void> {
  await Promise.all(STARTED_OVER.map((store) => tx.table(store).clear()))
  await repull(tx)
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
  recording_loops!: Table<LocalRecordingLoop, string>
  scans!: Table<LocalScan, string>
  scan_files!: Table<ScanFile, string>
  recording_files!: Table<RecordingFile, string>
  recording_chunks!: Table<RecordingChunk, [string, number]>
  play_events!: Table<LocalPlayEvent, string>
  practice_sessions!: Table<LocalPracticeSession, string>
  status_changes!: Table<LocalStatusChange, string>
  scan_views!: Table<LocalScanView, string>
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

    this.version(6)
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

    // A new store needs no reshaping, so rows and the outbox stay as they are.
    this.version(7).stores({
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
      songs: null,
      user_songs: null,
    })

    // Links no longer carry a label, and the API refuses a push that still names one.
    this.version(8)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('recording_links')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            delete row.label
          })
        await tx
          .table('outbox')
          .filter((entry: OutboxEntry) => entry.table === 'recording_links')
          .modify((entry: OutboxEntry) => {
            if (entry.data) delete entry.data.label
          })
      })

    // The processing watch queries by state, so a write to any other recording passes it by.
    this.version(9).stores({ recordings: 'id, tune_id, state' })

    // Recordings predate provenance; the API refuses a push that leaves it out.
    this.version(10)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('recordings')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            row.origin ??= 'own'
            row.origin_url ??= null
          })
        await tx
          .table('outbox')
          .filter((entry: OutboxEntry) => entry.table === 'recordings' && entry.data != null)
          .modify((entry: OutboxEntry) => {
            if (!entry.data) return
            entry.data.origin ??= 'own'
            entry.data.origin_url ??= null
          })
      })

    // A database from before these stores holds none of the server's pages, so it pulls every
    // row again to fetch them.
    this.version(11)
      .stores({ notation_pages: 'id, tune_id, state', notation_files: 'id, origin' })
      .upgrade(repull)

    // A recording's one date splits in two. It always said when the row was added; it says
    // when the music was played only for a take, the one source captured as it was played.
    this.version(12)
      .stores({})
      .upgrade(async (tx) => {
        await tx.table('recordings').toCollection().modify(splitRecordingDate)
        await tx
          .table('outbox')
          .filter((entry: OutboxEntry) => entry.table === 'recordings' && entry.data != null)
          .modify((entry: OutboxEntry) => {
            if (entry.data) splitRecordingDate(entry.data)
          })
      })

    // New stores need no reshaping, so rows and the outbox stay as they are.
    this.version(13).stores({
      play_events: 'id, started_at',
      practice_sessions: 'id, started_at',
      status_changes: 'id, changed_at',
    })

    // The notation stores become the scan stores. Rows, images, queued changes, and the invert
    // setting move across, so pending uploads and unsent edits carry on.
    this.version(14)
      .stores({
        scans: 'id, tune_id, state',
        scan_files: 'id, origin',
        notation_pages: null,
        notation_files: null,
      })
      .upgrade(async (tx) => {
        await tx.table('scans').bulkPut(await tx.table('notation_pages').toArray())
        await tx.table('scan_files').bulkPut(await tx.table('notation_files').toArray())
        await tx
          .table('outbox')
          .filter((entry: { table: string }) => entry.table === 'notation_pages')
          .modify((entry: { table: string }) => {
            entry.table = 'scans'
          })
        const invert = await tx.table('meta').get(LEGACY_INVERT_KEY)
        if (invert) {
          await tx.table('meta').put({ key: META_SCAN_INVERT, value: invert.value })
          await tx.table('meta').delete(LEGACY_INVERT_KEY)
        }
      })

    this.version(15).stores({ scan_views: 'id, started_at' })
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

function splitRecordingDate(row: Record<string, unknown>) {
  // A row with added_at already has the new shape, such as one an older tab pulled after the
  // server moved, and its recorded date may be one the server or the user set.
  if (!('recorded_at' in row) || row.added_at != null) return
  row.added_at = row.recorded_at
  if (row.source === 'microphone' && row.recorded_at != null) {
    row.recorded_precision = 'time'
  } else {
    row.recorded_at = null
    row.recorded_precision = null
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

type RowsTables = { [K in SyncTableName]: Table<LocalRows[K], string> }

export function rowsTable<T extends SyncTableName>(
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
    scans: db.scans,
    recording_loops: db.recording_loops,
    user_settings: db.user_settings,
  }
  return tables[name]
}

export function syncTables(db: CrosstuneDb): Table[] {
  return TABLE_NAMES.map((name) => db[name])
}

/** The activity history stores, filled by recorded events, their push results, and the events pull. */
export function eventTables(db: CrosstuneDb): Table[] {
  return [db.play_events, db.practice_sessions, db.scan_views, db.status_changes]
}
