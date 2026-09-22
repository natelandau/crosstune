import { useAuth, useUser } from '@clerk/react'
import { IonItem, IonLabel } from '@ionic/react'
import { useAuthSession } from '../../auth/AuthContext'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { Group } from '../../ui/Group'
import { signOutAndForget } from './signOut'

export const SIGN_OUT = 'Sign out'
export const SIGN_OUT_OFFLINE = 'Sign out needs a connection.'
export const SIGNED_IN_OFFLINE = 'Signed in (offline)'

/**
 * Who is signed in, and the way out. Sign out is the one control this client disables offline
 * rather than letting it refuse: Clerk cannot end the session without a connection, and the
 * local catalog must not be deleted while the session it belongs to is still open.
 */
export function AccountGroup() {
  const db = useDb()
  const { userId, offline } = useAuthSession()
  const { user } = useUser()
  const { signOut } = useAuth()
  const engine = useSyncEngine()
  const { error, pending, run } = useAction()
  // Clerk is not loaded in an offline session, so the email is the first choice and the raw id
  // the last resort.
  const identity = user?.primaryEmailAddress?.emailAddress ?? (offline ? SIGNED_IN_OFFLINE : userId)
  return (
    <Group header="Account" error={error} footer={offline ? SIGN_OUT_OFFLINE : undefined}>
      <IonItem lines="full">
        <IonLabel>{identity}</IonLabel>
      </IonItem>
      <IonItem
        button
        detail={false}
        disabled={pending || offline}
        onClick={() =>
          run(() => signOutAndForget({ db, userId, engine, signOut: () => signOut() }))
        }
      >
        <IonLabel color="danger">{SIGN_OUT}</IonLabel>
      </IonItem>
    </Group>
  )
}
