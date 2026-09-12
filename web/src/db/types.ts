import type {
  ListItemRow,
  ListRow,
  RecordingLinkRow,
  SongRow,
  TableName,
  UserSongRow,
} from '../api/types'

export type { TableName }

export const TABLE_NAMES = [
  'songs',
  'user_songs',
  'lists',
  'list_items',
  'recording_links',
] as const satisfies readonly TableName[]

export const STATUSES = ['known', 'learning', 'want_to_learn'] as const
export type SongStatus = (typeof STATUSES)[number]

export const MODES = ['major', 'minor', 'mixolydian', 'dorian', 'other'] as const
export type Mode = (typeof MODES)[number]

export const TIME_SIGNATURES = ['4/4', '2/4', '2/2', '3/4', '6/8', '9/8', '12/8', 'other'] as const
export type TimeSignature = (typeof TIME_SIGNATURES)[number]

export const PROVIDERS = [
  'youtube',
  'spotify',
  'apple_music',
  'bandcamp',
  'soundcloud',
  'other',
] as const
export type Provider = (typeof PROVIDERS)[number]

// The server sets ownership from the token; local rows never carry it.
export const OWNERSHIP_KEYS = ['owner_user_id', 'user_id', 'added_by_user_id'] as const
type OwnershipKey = (typeof OWNERSHIP_KEYS)[number]

export type Local<Row> = Omit<Row, OwnershipKey>

export type LocalSong = Local<SongRow>
export type LocalUserSong = Local<UserSongRow>
export type LocalRecordingLink = Local<RecordingLinkRow>
export type LocalList = Local<ListRow>
export type LocalListItem = Local<ListItemRow>

export interface LocalRows {
  songs: LocalSong
  user_songs: LocalUserSong
  lists: LocalList
  list_items: LocalListItem
  recording_links: LocalRecordingLink
}
export type LocalRow = LocalRows[TableName]

export interface OutboxEntry {
  seq?: number
  table: TableName
  row_id: string
  op: 'upsert' | 'delete'
  updated_at: string
  data: Record<string, unknown> | null
}

export interface MetaEntry {
  key: string
  value: unknown
}

const BOOKKEEPING_KEYS = [
  'id',
  'updated_at',
  'deleted_at',
  'server_seq',
  ...OWNERSHIP_KEYS,
] as const

/** The client-editable fields of a row, the only thing a push upsert may carry. */
export function toChangeData(row: LocalRow): Record<string, unknown> {
  const data: Record<string, unknown> = { ...row }
  for (const key of BOOKKEEPING_KEYS) delete data[key]
  return data
}

/** A server row without its ownership columns, ready to store locally. */
export function stripOwnership<Row extends object>(row: Row): Local<Row> {
  const local: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  for (const key of OWNERSHIP_KEYS) delete local[key]
  return local as Local<Row>
}
