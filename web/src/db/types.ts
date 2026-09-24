import type {
  ListItemRow,
  ListRow,
  RecordingLinkRow,
  RecordingRow,
  SongRow,
  TableName,
  UserSettingsRow,
  UserSongRow,
} from '../api/types'
import { INSTRUMENTS, type Instrument } from '../api/vocabulary'

export type { TableName }

export const TABLE_NAMES = [
  'songs',
  'user_songs',
  'lists',
  'list_items',
  'recording_links',
  'recordings',
  'user_settings',
] as const satisfies readonly TableName[]

export function isInstrument(value: unknown): value is Instrument {
  return typeof value === 'string' && (INSTRUMENTS as readonly string[]).includes(value)
}

// The server sets ownership from the token; local rows never carry it.
export const OWNERSHIP_KEYS = ['owner_user_id', 'user_id', 'added_by_user_id'] as const
type OwnershipKey = (typeof OWNERSHIP_KEYS)[number]

// A pulled row may carry a value from a server newer than this client, so the local copy
// keeps every server vocabulary as a plain string and reads it through a guard such as
// isInstrument. The contract's unions stay the type of what this client itself offers. The
// widening covers every string literal on a row, not only the vocabularies.
type Loosen<T> = T extends string ? string : T extends readonly (infer Item)[] ? Loosen<Item>[] : T

export type Local<Row> = {
  [Key in keyof Omit<Row, OwnershipKey>]: Loosen<Omit<Row, OwnershipKey>[Key]>
}

// A song written by this client has no tunings map until the form edits it directly.
export type LocalSong = Local<Omit<SongRow, 'tunings'>> & { tunings?: Local<SongRow>['tunings'] }
export type LocalUserSong = Local<UserSongRow>
export type LocalRecordingLink = Local<RecordingLinkRow>
export type LocalList = Local<ListRow>
export type LocalListItem = Local<ListItemRow>
export type LocalUserSettings = Local<UserSettingsRow>
export type LocalRecording = Local<RecordingRow>

// Removed in tag B. An API before tag A knows the five-string banjo only as "banjo" and the
// tag A API reads both spellings, so this client reads either and writes "banjo", which is
// safe whichever API it meets.
const LEGACY_BANJO = 'banjo'

/** An instrument value as stored or pulled, with the legacy banjo read as five_string_banjo. */
export function readInstrument(value: string): string {
  return value === LEGACY_BANJO ? 'five_string_banjo' : value
}

/** An instrument value as written and pushed, with five_string_banjo spelled "banjo". */
export function writeInstrument(value: string): string {
  return value === 'five_string_banjo' ? LEGACY_BANJO : value
}

/** The instruments a settings row holds, or null when there is no usable row. */
export function storedInstruments(
  row: LocalUserSettings | null | undefined,
): readonly string[] | null {
  if (!row || row.deleted_at || !Array.isArray(row.instruments)) return null
  return [...new Set(row.instruments.map(readInstrument))]
}

export interface LocalRows {
  songs: LocalSong
  user_songs: LocalUserSong
  lists: LocalList
  list_items: LocalListItem
  recording_links: LocalRecordingLink
  recordings: LocalRecording
  user_settings: LocalUserSettings
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

// The upload and transcode pipeline computes these for a recording; the client only reads them.
const RECORDING_PIPELINE_KEYS = [
  'state',
  'duration_ms',
  'playback_mime',
  'playback_bytes',
  'error',
] as const

const BOOKKEEPING_KEYS = [
  'id',
  'updated_at',
  'deleted_at',
  'server_seq',
  ...OWNERSHIP_KEYS,
  ...RECORDING_PIPELINE_KEYS,
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
