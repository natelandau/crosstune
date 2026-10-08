import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from '../auth/AuthContext'
import { DbContext } from '../db/DbProvider'
import { CrosstuneDb } from '../db/schema'
import { SyncContext } from '../sync/SyncProvider'
import type { SyncStatus } from '../sync/types'
import { fakeEngine, testSession } from '../test/fakeSync'
import { App } from '../app/App'
import { createAppRouter } from '../app/router'
import { SignIn } from '../app/SignIn'
import { FixedNow } from '../ui/useNow'
import { seedFixture } from './seed'

const SYNC_STATUSES: readonly SyncStatus[] = ['idle', 'syncing', 'offline', 'unauthorized', 'error']

/**
 * Mounts the app on a seeded local catalog with a signed-in test session and no network,
 * for `just web::kit-shots`. `fixture=signin` shows the sign-in screen instead, `sync` picks
 * the status the stand-in sync engine reports, and `now`, an ISO time, fixes the clock the seed
 * dates count back from and every label reads, so two captures on different days agree.
 */
export async function mountFixture(element: HTMLElement, params: URLSearchParams) {
  const root = createRoot(element)
  if (params.get('fixture') === 'signin') {
    root.render(
      <StrictMode>
        <SignIn staleSession={false} />
      </StrictMode>,
    )
    return
  }
  // A fresh catalog on every load, so a capture never sees what an earlier one wrote.
  const db = new CrosstuneDb('crosstune-fixture')
  await db.delete()
  await db.open()
  const fixed = Date.parse(params.get('now') ?? '')
  const now = Number.isNaN(fixed) ? new Date() : new Date(fixed)
  await seedFixture(db, now)
  const status = SYNC_STATUSES.find((value) => value === params.get('sync')) ?? 'idle'
  // A recent sync, so the Sync and storage page and the account block show a real time.
  const lastSynced = new Date(now.getTime() - 4 * 60_000).toISOString()
  const engine = fakeEngine({ status: () => status, lastSyncedAt: () => lastSynced })
  root.render(
    <StrictMode>
      <AuthProvider value={testSession}>
        <DbContext.Provider value={db}>
          <SyncContext.Provider value={engine}>
            <FixedNow value={Number.isNaN(fixed) ? null : fixed}>
              <App router={createAppRouter()} />
            </FixedNow>
          </SyncContext.Provider>
        </DbContext.Provider>
      </AuthProvider>
    </StrictMode>,
  )
}
