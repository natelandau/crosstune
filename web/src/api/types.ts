import type { components } from './schema'

export type Schemas = components['schemas']

export type ResolveResponse = Schemas['ResolveResponse']
export type Problem = Schemas['Problem']
export type MeResponse = Schemas['MeResponse']
export type StorageResponse = Schemas['StorageResponse']
export type SignedUrl = Schemas['SignedUrl']
export type UploadSlotRequest = Schemas['UploadSlotRequest']

// This client syncs in the API's first wire names, which call a tune a song: the rows the
// contract documents, with songs, user_songs, song_id, and user_song_id in place of the
// tune names.
type Renamed<Row, From extends keyof Row, To extends string> = {
  [Key in keyof Row as Key extends From ? To : Key]: Row[Key]
}

export type SongRow = Schemas['TuneRow']
export type UserSongRow = Renamed<Schemas['UserTuneRow'], 'tune_id', 'song_id'>
export type RecordingLinkRow = Renamed<Schemas['RecordingLinkRow'], 'tune_id', 'song_id'>
export type ListRow = Schemas['ListRow']
export type ListItemRow = Renamed<Schemas['ListItemRow'], 'user_tune_id', 'user_song_id'>
export type UserSettingsRow = Schemas['UserSettingsRow']
export type RecordingRow = Renamed<Schemas['RecordingRow'], 'tune_id', 'song_id'>

interface RowsByTable {
  songs: SongRow
  user_songs: UserSongRow
  lists: ListRow
  list_items: ListItemRow
  recording_links: RecordingLinkRow
  recordings: RecordingRow
  user_settings: UserSettingsRow
}

export type TableName = keyof RowsByTable
export type Change = Omit<Schemas['Change'], 'table'> & { table: TableName }
type ResultFields = Omit<Schemas['ListChangeResult'], 'table' | 'row'>
export type ChangeResult = {
  [Table in TableName]: ResultFields & { table: Table; row?: RowsByTable[Table] | null }
}[TableName]
export type PullRow = { [Table in TableName]: { table: Table; row: RowsByTable[Table] } }[TableName]
export interface PushResponse {
  results: ChangeResult[]
}
export type PullResponse = Omit<Schemas['PullResponse'], 'rows'> & { rows: PullRow[] }

export interface SyncApi {
  push(changes: Change[]): Promise<PushResponse>
  pull(since: number): Promise<PullResponse>
  resolveLink(url: string): Promise<ResolveResponse>
  me(): Promise<MeResponse>
  requestUploadSlot(recordingId: string, body: UploadSlotRequest): Promise<SignedUrl>
  uploadFinished(recordingId: string): Promise<void>
  retryRecording(recordingId: string): Promise<void>
  downloadUrl(recordingId: string): Promise<SignedUrl>
  /** PUT bytes to a presigned URL. No bearer token: the signature is the credential. */
  putObject(url: string, blob: Blob, contentType: string): Promise<void>
  getObject(url: string): Promise<Blob>
}
