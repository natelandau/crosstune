import { useAuth, useUser } from '@clerk/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuthSession } from '../../auth/AuthContext'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { getInvalidChangeCount } from '../../db/meta'
import { useSyncEngine, useSyncStatus } from '../../sync/SyncProvider'
import { APP_VERSION } from '../../version'
import { signOutAndForget } from './signOut'

export function SettingsScreen() {
  const db = useDb()
  const { userId, offline } = useAuthSession()
  const { user } = useUser()
  const { signOut } = useAuth()
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const rejected = useLiveQuery(() => getInvalidChangeCount(db), [db]) ?? 0
  const { error, pending, run } = useAction()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase opacity-60">Account</h2>
        <p>
          {user?.primaryEmailAddress?.emailAddress ?? (offline ? 'Signed in (offline)' : userId)}
        </p>
        <button
          type="button"
          className="btn btn-outline btn-error"
          onClick={() =>
            run(() => signOutAndForget({ db, userId, engine, signOut: () => signOut() }))
          }
          disabled={pending || offline}
        >
          Sign out
        </button>
        {offline ? <p className="text-sm opacity-70">Sign out needs a connection.</p> : null}
        {error ? (
          <p role="alert" className="text-error text-sm">
            {error}
          </p>
        ) : null}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase opacity-60">Sync</h2>
        <p>Status: {status}</p>
        {rejected > 0 ? (
          <p role="status" className="text-warning text-sm">
            {rejected === 1
              ? '1 change was rejected by the server and is only on this device.'
              : `${rejected} changes were rejected by the server and are only on this device.`}
          </p>
        ) : null}
        <button type="button" className="btn" onClick={() => void engine.sync()}>
          Sync now
        </button>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase opacity-60">About</h2>
        <p className="text-sm opacity-70">Crosstune {APP_VERSION}</p>
      </section>
    </div>
  )
}
