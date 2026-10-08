import { useAuth, useUser } from '@clerk/react'
import { useAuthSession } from '../../auth/AuthContext'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { useAction } from '../../ui/useAction'
import { SIGNED_IN_OFFLINE } from './settingsCopy'
import { signOutAndForget } from './signOut'

export interface AccountSettings {
  /** Who Clerk says is signed in, or null while Clerk has no user, as in an offline session. */
  identity: { name: string | null; email: string | null } | null
  /** One line naming the account: the email, else the offline note, else the raw user id. */
  label: string
  /** Signing out and deleting the account need a connection, so both are disabled offline. */
  offline: boolean
  error: string | null
  pending: boolean
  signOut: () => void
}

/**
 * Who is signed in, and the way out. Sign out is disabled offline rather than refused: Clerk
 * cannot end the session without a connection, and the local catalog must not be deleted while
 * the session it belongs to is still open.
 */
export function useAccountSettings(): AccountSettings {
  const db = useDb()
  const { userId, offline } = useAuthSession()
  const { user } = useUser()
  const { signOut } = useAuth()
  const engine = useSyncEngine()
  const { error, pending, run } = useAction()
  const email = user?.primaryEmailAddress?.emailAddress ?? null
  const identity = user ? { name: user.fullName ?? null, email } : null
  return {
    identity,
    label: email ?? (offline ? SIGNED_IN_OFFLINE : userId),
    offline,
    error,
    pending,
    signOut: () => run(() => signOutAndForget({ db, userId, engine, signOut: () => signOut() })),
  }
}
