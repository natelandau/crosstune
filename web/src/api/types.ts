import type { components } from './schema'

export type Schemas = components['schemas']

export type Change = Schemas['Change']
export type TableName = Change['table']
export type PushResponse = Schemas['PushResponse']
export type PullResponse = Schemas['PullResponse']
export type ChangeResult = PushResponse['results'][number]
export type PullRow = PullResponse['rows'][number]
export type ResolveResponse = Schemas['ResolveResponse']
export type Problem = Schemas['Problem']

export type SongRow = Schemas['SongRow']
export type UserSongRow = Schemas['UserSongRow']
export type RecordingLinkRow = Schemas['RecordingLinkRow']
export type ListRow = Schemas['ListRow']
export type ListItemRow = Schemas['ListItemRow']
export type UserSettingsRow = Schemas['UserSettingsRow']
export type RecordingRow = Schemas['RecordingRow']
export type MeResponse = Schemas['MeResponse']
export type StorageResponse = Schemas['StorageResponse']
export type SignedUrl = Schemas['SignedUrl']
export type UploadSlotRequest = Schemas['UploadSlotRequest']

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
