import { IonItem } from '@ionic/react'
import type { ReactNode } from 'react'

/**
 * One shape for every labeled field inside a card: the label leads, the control or value
 * trails. A select, a text field, and a date row all take it, so a list of them reads as one
 * list rather than as a pile of different controls.
 */
export function FieldRow({
  label,
  detail,
  children,
}: {
  label: ReactNode
  /** Rendered as `data-detail`, naming the detail field the row edits. */
  detail?: string
  children: ReactNode
}) {
  return (
    <IonItem data-detail={detail}>
      <span data-row-label className="type-body shrink-0">
        {label}
      </span>
      {children}
    </IonItem>
  )
}
