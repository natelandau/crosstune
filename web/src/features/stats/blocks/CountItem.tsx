import { IonItem, IonLabel, IonNote } from '@ionic/react'

/**
 * A labeled count. With `onOpen` the row is a control that leads somewhere else and carries a
 * chevron; without it the row only reads.
 */
export function CountItem({
  label,
  count,
  onOpen,
}: {
  label: string
  count: number
  onOpen?: () => void
}) {
  return (
    <IonItem
      lines="full"
      button={onOpen !== undefined}
      detail={onOpen !== undefined}
      onClick={onOpen}
    >
      <IonLabel className="truncate">{label}</IonLabel>
      <IonNote slot="end" className="tabular-nums">
        {count.toLocaleString('en-US')}
      </IonNote>
    </IonItem>
  )
}
