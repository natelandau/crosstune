import type { components } from './schema'
import type { Provider } from './vocabulary'

type Schemas = components['schemas']

export type Change = Schemas['Change']
export type TableName = Change['table']
export type PushResponse = Schemas['PushResponse']
export type PullResponse = Schemas['PullResponse']
export type ChangeResult = PushResponse['results'][number]
export type PullRow = PullResponse['rows'][number]
export type EventsResponse = Schemas['EventsResponse']
export type EventRow = EventsResponse['rows'][number]
export type ResolveResponse = Schemas['ResolveResponse']
export type SearchResponse = Schemas['SearchResponse']
export type SearchGroup = Schemas['SearchGroup']
export type SearchResult = Schemas['SearchResult']
export type Problem = Schemas['Problem']

export type EntitlementRow = Schemas['EntitlementRow']
export type TuneRow = Schemas['TuneRow']
export type UserTuneRow = Schemas['UserTuneRow']
export type RecordingLinkRow = Schemas['RecordingLinkRow']
export type RecordingLoopRow = Schemas['RecordingLoopRow']
export type ScanRow = Schemas['ScanRow']
export type ListRow = Schemas['ListRow']
export type ListItemRow = Schemas['ListItemRow']
export type UserSettingsRow = Schemas['UserSettingsRow']
export type RecordingRow = Schemas['RecordingRow']
export type PlayEventRow = Schemas['PlayEventRow']
export type PracticeSessionRow = Schemas['PracticeSessionRow']
export type ScanViewRow = Schemas['ScanViewRow']
export type StatusChangeRow = Schemas['StatusChangeRow']
export type MeResponse = Schemas['MeResponse']
export type SignedUrl = Schemas['SignedUrl']
export type DownloadUrl = Schemas['DownloadUrl']
export type PeaksUrl = Schemas['PeaksUrl']
export type UploadSlotRequest = Schemas['UploadSlotRequest']
export type ScanUploadSlotRequest = Schemas['ScanUploadSlotRequest']
export type Notice = Schemas['NoticeRequest']['notice']

export interface SyncApi {
  push(changes: Change[]): Promise<PushResponse>
  pull(since: number): Promise<PullResponse>
  /** A page of plays, practice sessions, scan views, and status changes after the events cursor. */
  events(since: number): Promise<EventsResponse>
  resolveLink(url: string): Promise<ResolveResponse>
  searchRecordings(q: string, providers: Provider[], country: string): Promise<SearchResponse>
  me(): Promise<MeResponse>
  deleteAccount(): Promise<void>
  /** Records that the user saw a one-time notice, so no device shows it again. */
  recordNotice(notice: Notice): Promise<void>
  requestUploadSlot(recordingId: string, body: UploadSlotRequest): Promise<SignedUrl>
  uploadFinished(recordingId: string): Promise<void>
  retryRecording(recordingId: string): Promise<void>
  /** The revision and start it carries are what the server signed the URL for, which can
   * already be newer than the row this client has pulled. An abort of `signal` stops the
   * request. */
  downloadUrl(recordingId: string, signal?: AbortSignal): Promise<DownloadUrl>
  /** The revision it carries is what the server signed the URL for. */
  peaksUrl(recordingId: string): Promise<PeaksUrl>
  requestScanUploadSlot(scanId: string, body: ScanUploadSlotRequest): Promise<SignedUrl>
  scanUploadFinished(scanId: string): Promise<void>
  /** An abort of `signal` stops the request. */
  scanDownloadUrl(scanId: string, signal?: AbortSignal): Promise<SignedUrl>
  /** PUT bytes to a presigned URL. No bearer token: the signature is the credential. */
  putObject(url: string, blob: Blob, contentType: string): Promise<void>
  /**
   * GET bytes from a presigned URL. No bearer token: the signature is the credential. An abort
   * of `signal` stops the read like its timeout does.
   */
  getObject(url: string, signal?: AbortSignal): Promise<Blob>
}
