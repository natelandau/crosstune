import { IonRefresher, IonRefresherContent, type RefresherCustomEvent } from '@ionic/react'
import { usePointer } from '../platform/pointer'
import { useSyncEngine } from './SyncProvider'

/** Pull to sync, offered only on touch, where pulling a list down is the gesture people know. */
export function SyncRefresher() {
  const engine = useSyncEngine()
  const pointer = usePointer()
  if (pointer !== 'touch') return null
  const refresh = (event: RefresherCustomEvent) => {
    void engine.sync().finally(() => event.detail.complete())
  }
  return (
    <IonRefresher slot="fixed" onIonRefresh={refresh}>
      <IonRefresherContent />
    </IonRefresher>
  )
}
