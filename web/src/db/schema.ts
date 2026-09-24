import Dexie, { type EntityTable, type Table } from 'dexie'
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

  constructor(name: string) {
    super(name)
    // Only keys used in where() clauses are indexed. Null is not indexable, so
    // deleted_at and archived_at are filtered in memory.
    this.version(5).stores({
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

export function rowsTable<T extends TableName>(
  db: CrosstuneDb,
  name: T,
): Table<LocalRows[T], string> {
  return db[name] as Table<LocalRows[T], string>
}

export function syncTables(db: CrosstuneDb): Table[] {
  return TABLE_NAMES.map((name) => db[name])
}
