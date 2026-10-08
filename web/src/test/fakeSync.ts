import type { AuthSession } from '../auth/AuthContext'
import type { SyncEngine } from '../sync/types'

// Free of Vitest, so a dev-only fixture page can mount the app with the same stand-ins.

export function fakeEngine(overrides: Partial<SyncEngine> = {}): SyncEngine {
  return {
    sync: async () => {},
    status: () => 'idle',
    lastSyncedAt: () => null,
    subscribe: () => () => {},
    transfer: async () => {},
    transferStatus: () => 'idle',
    subscribeTransfer: () => () => {},
    resolveLink: async () => null,
    searchRecordings: async () => ({ kind: 'failed' }),
    download: async () => null,
    peaks: async () => null,
    retry: async () => {},
    deleteAccount: async () => {},
    onAccountDeleted: () => () => {},
    stop: () => {},
    resume: () => {},
    pullEvents: async () => {},
    ...overrides,
  }
}

/** A signed-in, online session for tests that do not care who is signed in. */
export const testSession: AuthSession = {
  userId: 'user_1',
  getToken: async () => 't',
  offline: false,
}
