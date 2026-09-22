import { IonItem } from '@ionic/react'
import type { ReactNode } from 'react'

export const NOT_SET = 'Not set'

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
      <span data-row-label className="type-body">
        {label}
      </span>
      {/* The trailing slot is how an item puts a value against its far edge; a control left in
          the default slot sizes to its own text and sits hard against the label. */}
      <div slot="end" data-row-end className="flex min-w-0 items-center">
        {children}
      </div>
    </IonItem>
  )
}
