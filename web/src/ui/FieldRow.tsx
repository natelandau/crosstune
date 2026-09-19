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

/**
 * A row's trailing value, or its placeholder when nothing is set. It gives up its own width
 * before the label does and elides rather than wrapping, so a long value never changes the
 * row's height or pushes its label out of the card.
 */
export function RowValue({ value, placeholder }: { value: string; placeholder: string }) {
  const text = value.trim()
  return (
    <span
      data-row-value
      className={`type-body ms-auto min-w-0 truncate text-end tabular-nums ${
        text ? '' : 'text-(--ion-color-medium)'
      }`}
    >
      {text || placeholder}
    </span>
  )
}
