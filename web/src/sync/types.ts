import type {
  DeleteAccountOptions,
  PlaceResult,
  ResolveResponse,
  SearchGroup,
  SnapshotQuery,
  SyncApi,
} from '../api/types'
import type { Provider } from '../api/vocabulary'

export type { SyncApi }

/** A 429 is its own kind so the caller can show the wait; every other failure is `failed`. */
export type SearchOutcome =
  | { kind: 'ok'; groups: SearchGroup[] }
  | { kind: 'offline' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'failed' }

/** Like `SearchOutcome`, plus `unavailable` for a server with no place search configured. */
export type PlaceSearchOutcome =
  | { kind: 'ok'; results: PlaceResult[] }
  | { kind: 'offline' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'unavailable' }
  | { kind: 'failed' }

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unauthorized' | 'error'

export type TransferStatus = 'idle' | 'transferring' | 'offline' | 'error'

/** How a withdrawal ended. */
export type WithdrawOutcome =
  | 'withdrawn'
  | 'window_closed'
  | 'already_withdrawn'
  /** Refused for another reason, such as no web subscription. */
  | 'refused'
  | 'failed'

export interface SyncEngine {
  sync(): Promise<void>
  status(): SyncStatus
  /** ISO timestamp of the last run that finished clean, or null before the first. */
  lastSyncedAt(): string | null
  subscribe(listener: (status: SyncStatus) => void): () => void
  /** Run the upload and download passes now, or once more after the run in flight. */
  transfer(): Promise<void>
  transferStatus(): TransferStatus
  subscribeTransfer(listener: (status: TransferStatus) => void): () => void
  /**
   * Pull plays, practice sessions, scan views, and status changes page by page until caught
   * up. Does nothing offline; rejects when a page fails, keeping the pages already stored.
   */
  pullEvents(): Promise<void>
  resolveLink(url: string): Promise<ResolveResponse | null>
  searchRecordings(q: string, providers: Provider[], country: string): Promise<SearchOutcome>
  searchPlaces(q: string): Promise<PlaceSearchOutcome>
  /** A fresh MapKit JS token, or null offline or when the server cannot issue one. */
  mapKitToken(): Promise<string | null>
  /** A signed map image URL for a point, or null offline or when the server cannot make one. */
  placeSnapshot(query: SnapshotQuery): Promise<string | null>
  /** Fetch one recording's audio now, storing it locally. Null when it cannot be fetched. */
  download(recordingId: string): Promise<Blob | null>
  /** Fetch one recording's waveform now, storing it locally. Null when it cannot be fetched. */
  peaks(recordingId: string): Promise<Uint8Array | null>
  /**
   * Read one recording's audio or one scan's image from the server, storing nothing on this
   * device. Tries once more after a dropped connection or a server error, and rejects when it
   * still cannot be read, offline included, or when `signal` aborts.
   */
  fetchFile(kind: 'recording' | 'scan', id: string, signal?: AbortSignal): Promise<Blob>
  /** Ask the server to transcode a failed recording again. */
  retry(recordingId: string): Promise<void>
  /** Ask the server to read the account's purchases from the store now. */
  refreshBilling(): Promise<void>
  /**
   * Withdraw from the first web payment for a full refund, then pull until the ended plan is
   * local. A 409 is a refusal, named by the server's reason; `failed` is anything else, offline
   * included.
   */
  withdraw(): Promise<WithdrawOutcome>
  deleteAccount(options?: DeleteAccountOptions): Promise<void>
  /** Called with the engine already stopped when the server says the account is gone. */
  onAccountDeleted(listener: () => void): () => void
  stop(): void
  resume(): void
}
