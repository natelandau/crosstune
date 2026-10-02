import { useAuth, useUser } from '@clerk/react'
import { IonItem, IonLabel } from '@ionic/react'
import { useState } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { Group } from '../../ui/Group'
import { DeleteAccountSheet } from './DeleteAccountSheet'
import { DELETE_ACCOUNT } from './deleteAccountCopy'
import { EXPORT_DATA } from './export/exportCopy'
import { ExportSheet } from './export/ExportSheet'
import { signOutAndForget } from './signOut'

export const SIGN_OUT = 'Sign out'
export const ACCOUNT_OFFLINE = 'Signing out and deleting your account need a connection.'
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
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Clerk is not loaded in an offline session, so the email is the first choice and the raw id
  // the last resort.
  const identity = user?.primaryEmailAddress?.emailAddress ?? (offline ? SIGNED_IN_OFFLINE : userId)
  return (
    <>
      <Group header="Account" error={error} footer={offline ? ACCOUNT_OFFLINE : undefined}>
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
        {/* Reads only the local store, so it needs no connection. */}
        <IonItem button detail={false} disabled={pending} onClick={() => setExporting(true)}>
          <IonLabel>{EXPORT_DATA}</IonLabel>
        </IonItem>
        <IonItem
          button
          detail={false}
          disabled={pending || offline}
          onClick={() => setDeleting(true)}
        >
          <IonLabel color="danger">{DELETE_ACCOUNT}</IonLabel>
        </IonItem>
      </Group>
      <ExportSheet open={exporting} onClose={() => setExporting(false)} />
      <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />
    </>
  )
}
