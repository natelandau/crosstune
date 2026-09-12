import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  LocalList,
  LocalListItem,
  LocalRecordingLink,
  LocalRows,
  LocalSong,
  LocalUserSong,
  MetaEntry,
  OutboxEntry,
  TableName,
} from './types'

export class CrosstuneDb extends Dexie {
  // EntityTable<T, K> makes the key property K optional on insert, Dexie's convention for
  // autoincrement keys. These tables use app-supplied ids, so Table<T, string> keeps inserts
  // requiring the full row instead of type-checking a runtime failure.
  songs!: Table<LocalSong, string>
  user_songs!: Table<LocalUserSong, string>
  recording_links!: Table<LocalRecordingLink, string>
  lists!: Table<LocalList, string>
  list_items!: Table<LocalListItem, string>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  meta!: Table<MetaEntry, string>

  constructor(name: string) {
    super(name)
    // Only keys used in where() clauses are indexed. Null is not indexable, so
    // deleted_at and archived_at are filtered in memory.
    this.version(1).stores({
      songs: 'id, title',
      user_songs: 'id, song_id',
      recording_links: 'id, song_id',
      lists: 'id',
      list_items: 'id, list_id, user_song_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
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
  return [db.songs, db.user_songs, db.lists, db.list_items, db.recording_links]
}
