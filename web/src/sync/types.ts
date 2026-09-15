import type { ResolveResponse, SyncApi } from '../api/types'

export type { SyncApi }

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
  resolveLink(url: string): Promise<ResolveResponse | null>
  /** Fetch one recording's audio now, storing it locally. Null when it cannot be fetched. */
  download(recordingId: string): Promise<Blob | null>
  /** Ask the server to transcode a failed recording again. */
  retry(recordingId: string): Promise<void>
  stop(): void
  resume(): void
}
