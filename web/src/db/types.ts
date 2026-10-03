import type {
  ListItemRow,
  ListRow,
  RecordingLinkRow,
  RecordingLoopRow,
  RecordingRow,
  TuneRow,
  TableName,
  UserSettingsRow,
  UserTuneRow,
} from '../api/types'
import {
  INSTRUMENTS,
  PLAY_FIRST,
  type Instrument,
  type PlayFirst,
  type Provider,
} from '../api/vocabulary'

export type { TableName }

export const TABLE_NAMES = [
  'tunes',
  'user_tunes',
  'lists',
  'list_items',
  'recording_links',
  'recordings',
  'recording_loops',
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

export type LocalTune = Local<TuneRow>
export type LocalUserTune = Local<UserTuneRow>
export type LocalRecordingLink = Local<RecordingLinkRow>
export type LocalList = Local<ListRow>
export type LocalListItem = Local<ListItemRow>
export type LocalUserSettings = Local<UserSettingsRow>
export type LocalRecording = Local<RecordingRow>
export type LocalRecordingLoop = Local<RecordingLoopRow>

/** The instruments a settings row holds, or null when there is no usable row. */
export function storedInstruments(
  row: LocalUserSettings | null | undefined,
): readonly string[] | null {
  if (!row || row.deleted_at || !Array.isArray(row.instruments)) return null
  return [...new Set(row.instruments)]
}

/**
 * Every provider a tune can be searched on, all but the generic `other` link, in the order the
 * API groups results: services that play inline first. Stored lists and summaries follow it, as
 * the server and the Apple client do.
 */
export const SEARCHABLE_PROVIDERS: readonly Provider[] = [
  'apple_music',
  'tidal',
  'internet_archive',
  'youtube',
  'spotify',
  'bandcamp',
  'soundcloud',
]

/**
 * Every service value a settings row holds: known searchable ones in that order, then
 * values this client does not know, so a newer client's choice survives a write. `other` is
 * never kept. A missing row or field means every searchable service; an empty list stays empty.
 */
export function storedSearchProviderValues(row: LocalUserSettings | null | undefined): string[] {
  if (!row || row.deleted_at || !Array.isArray(row.search_providers)) {
    return [...SEARCHABLE_PROVIDERS]
  }
  const chosen = new Set<string>(row.search_providers)
  const known = SEARCHABLE_PROVIDERS.filter((provider) => chosen.has(provider))
  const unknown = [...chosen].filter(
    (value) => value !== 'other' && !SEARCHABLE_PROVIDERS.some((provider) => provider === value),
  )
  return [...known, ...unknown]
}

/** The known services a settings row searches, in provider order. */
export function storedSearchProviders(row: LocalUserSettings | null | undefined): Provider[] {
  const values = new Set(storedSearchProviderValues(row))
  return SEARCHABLE_PROVIDERS.filter((provider) => values.has(provider))
}

/** The play-first choice a settings row holds, or recordings when there is no usable value. */
export function storedPlayFirst(row: LocalUserSettings | null | undefined): PlayFirst {
  return PLAY_FIRST.find((value) => value === row?.play_first) ?? 'recordings'
}

/**
 * The play-first value to write back: the stored one even when this client does not know it,
 * so a newer client's choice survives a write, or recordings when there is none.
 */
export function storedPlayFirstValue(row: LocalUserSettings | null | undefined): string {
  return row && !row.deleted_at && typeof row.play_first === 'string'
    ? row.play_first
    : storedPlayFirst(null)
}

export interface LocalRows {
  tunes: LocalTune
  user_tunes: LocalUserTune
  lists: LocalList
  list_items: LocalListItem
  recording_links: LocalRecordingLink
  recordings: LocalRecording
  recording_loops: LocalRecordingLoop
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
  'source_duration_ms',
  'playback_start_ms',
  'playback_end_ms',
  'playback_rev',
  'peaks_rev',
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
