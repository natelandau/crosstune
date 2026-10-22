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
export type PlaceSearchResponse = Schemas['PlaceSearchResponse']
export type PlaceResult = Schemas['PlaceResult']
export type MapKitTokenResponse = Schemas['MapKitTokenResponse']
export type SnapshotResponse = Schemas['SnapshotResponse']
export type Problem = Schemas['Problem']

export type EntitlementRow = Schemas['EntitlementRow']
export type TuneRow = Schemas['TuneRow']
export type UserTuneRow = Schemas['UserTuneRow']
export type RecordingLinkRow = Schemas['RecordingLinkRow']
export type PlaceRow = Schemas['PlaceRow']
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
export type RegionResponse = Schemas['RegionResponse']
export type Notice = Schemas['NoticeRequest']['notice']

export type SnapshotQuery = {
  lat: number
  lon: number
  accuracy_m?: number | null
  width: number
  height: number
  scheme: 'light' | 'dark'
}

export interface SyncApi {
  push(changes: Change[]): Promise<PushResponse>
  pull(since: number): Promise<PullResponse>
  /** A page of plays, practice sessions, scan views, and status changes after the events cursor. */
  events(since: number): Promise<EventsResponse>
  resolveLink(url: string): Promise<ResolveResponse>
  searchRecordings(q: string, providers: Provider[], country: string): Promise<SearchResponse>
  searchPlaces(q: string): Promise<PlaceSearchResponse>
  /** A short-lived MapKit JS token for this web origin. Rejects with a 503 `ApiError` when the
   * server has no Maps key. */
  mapKitToken(): Promise<MapKitTokenResponse>
  /** A signed map image URL for a point, with a circle when `accuracy_m` is set. */
  placeSnapshot(query: SnapshotQuery): Promise<SnapshotResponse>
  me(): Promise<MeResponse>
  /** Which privacy rules apply to the caller. Needs no session, so it works before sign-in. */
  region(): Promise<RegionResponse>
  /** With an Apple code from the web's Apple popup, the API also revokes Sign in with Apple. */
  deleteAccount(options?: DeleteAccountOptions): Promise<void>
  /** Records that the user saw a one-time notice, so no device shows it again. */
  recordNotice(notice: Notice): Promise<void>
  /** Asks the server to re-read the user's purchases, so a new subscription takes effect now. */
  refreshBilling(): Promise<void>
  /** Refunds the first web payment and ends the web subscription. Rejects with a 409 `ApiError`
   * whose `problem.reason` says why a withdrawal was refused. */
  withdraw(): Promise<void>
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

export interface DeleteAccountOptions {
  appleAuthorizationCode?: string
}
