import { IonItem, IonLabel, IonNote } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { getInvalidChangeCount } from '../../db/meta'
import { SYNC_STATUS_LABELS, TRANSFER_STATUS_LABELS } from '../../sync/labels'
import { useSyncEngine, useSyncStatus, useTransferStatus } from '../../sync/SyncProvider'
import { Group } from '../../ui/Group'

/**
 * The full sync state: the badge above the tab bar shows only the states that need attention, so
 * this is the one place a musician can see a clean or running sync too.
 */
export function SyncGroup() {
  const db = useDb()
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const transferStatus = useTransferStatus()
  const rejected = useLiveQuery(() => getInvalidChangeCount(db), [db]) ?? 0
  const syncAction = useAction()

  return (
    <Group header="Sync" error={syncAction.error}>
      <IonItem lines="full">
        <IonLabel>Status</IonLabel>
        <IonNote slot="end">{SYNC_STATUS_LABELS[status]}</IonNote>
      </IonItem>
      <IonItem lines="full">
        <IonLabel>Recordings</IonLabel>
        <IonNote slot="end">{TRANSFER_STATUS_LABELS[transferStatus]}</IonNote>
      </IonItem>
      {rejected > 0 ? (
        <IonItem lines="full">
          {/* Ionic's label styles outrank a role on the label itself, so the role goes on a
              paragraph inside it, which the type sheet reaches. */}
          <IonLabel className="whitespace-normal">
            <p role="status" className="type-footnote">
              {rejected === 1
                ? '1 change was rejected by the server and is only on this device.'
                : `${rejected} changes were rejected by the server and are only on this device.`}
            </p>
          </IonLabel>
        </IonItem>
      ) : null}
      <IonItem
        button
        detail={false}
        disabled={syncAction.pending}
        onClick={() => syncAction.run(() => engine.sync())}
      >
        <IonLabel>Sync now</IonLabel>
      </IonItem>
    </Group>
  )
}
