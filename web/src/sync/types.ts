import type { ResolveResponse, SyncApi } from '../api/types'

export type { SyncApi }

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unauthorized' | 'error'

export interface SyncEngine {
  sync(): Promise<void>
  status(): SyncStatus
  /** ISO timestamp of the last run that finished clean, or null before the first. */
  lastSyncedAt(): string | null
  subscribe(listener: (status: SyncStatus) => void): () => void
  resolveLink(url: string): Promise<ResolveResponse | null>
  stop(): void
  resume(): void
}
