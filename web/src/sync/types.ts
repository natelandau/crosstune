import type { ResolveResponse, SearchGroup, SyncApi } from '../api/types'
import type { Provider } from '../api/vocabulary'

export type { SyncApi }

/** A 429 is its own kind so the caller can show the wait; every other failure is `failed`. */
export type SearchOutcome =
  | { kind: 'ok'; groups: SearchGroup[] }
  | { kind: 'offline' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'failed' }

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unauthorized' | 'error'

export type TransferStatus = 'idle' | 'transferring' | 'offline' | 'error'

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
  /** Fetch one recording's audio now, storing it locally. Null when it cannot be fetched. */
  download(recordingId: string): Promise<Blob | null>
  /** Fetch one recording's waveform now, storing it locally. Null when it cannot be fetched. */
  peaks(recordingId: string): Promise<Uint8Array | null>
  /** Ask the server to transcode a failed recording again. */
  retry(recordingId: string): Promise<void>
  deleteAccount(): Promise<void>
  /** Called with the engine already stopped when the server says the account is gone. */
  onAccountDeleted(listener: () => void): () => void
  stop(): void
  resume(): void
}
