import Dexie, { type EntityTable, type Table } from 'dexie'
import type { RecordingChunk, RecordingFile } from './recordings'
import {
  TABLE_NAMES,
  type LocalList,
  type LocalListItem,
  type LocalRecording,
  type LocalRecordingLink,
  type LocalRows,
  type LocalSong,
  type LocalUserSettings,
  type LocalUserSong,
  type MetaEntry,
  type OutboxEntry,
  type TableName,
} from './types'

/** Move a song's single tuning into violin_tuning and give both instruments a slot. */
function splitTuning(song: Record<string, unknown>): void {
  if ('tuning' in song) {
    song.violin_tuning = song.tuning
    delete song.tuning
  }
  song.violin_tuning ??= null
  song.banjo_tuning ??= null
}

export class CrosstuneDb extends Dexie {
  // EntityTable<T, K> makes the key property K optional on insert, Dexie's convention for
  // autoincrement keys. These tables use app-supplied ids, so Table<T, string> keeps inserts
  // requiring the full row instead of type-checking a runtime failure.
  songs!: Table<LocalSong, string>
  user_songs!: Table<LocalUserSong, string>
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
    this.version(1).stores({
      songs: 'id, title',
      user_songs: 'id, song_id',
      recording_links: 'id, song_id',
      lists: 'id',
      list_items: 'id, list_id, user_song_id',
      outbox: '++seq, &[table+row_id]',
      meta: 'key',
    })
    // Cached songs must change shape with the server, which rejects unknown fields on push.
    this.version(2)
      .stores({ user_settings: 'id' })
      .upgrade((tx) =>
        Promise.all([
          tx.table('songs').toCollection().modify(splitTuning),
          // A queued songs upsert still carries the old field shape and is rejected on push otherwise.
          tx
            .table('outbox')
            .where('[table+row_id]')
            .between(['songs', Dexie.minKey], ['songs', Dexie.maxKey])
            .modify((entry: { data: Record<string, unknown> | null }) => {
              if (entry.data && 'tuning' in entry.data) splitTuning(entry.data)
            }),
        ]),
      )
    this.version(3).stores({
      recordings: 'id, song_id',
      recording_files: 'id, local_state',
      recording_chunks: '[recording_id+idx], recording_id',
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
