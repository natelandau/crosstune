import { IonButtons, IonContent, IonHeader, IonModal, IonTitle, IonToolbar } from '@ionic/react'
import { useRef, type ReactNode } from 'react'
import { usePointer } from '../platform/pointer'
import { useDialogName } from './dialogName'

// A role-less dismiss is the sheet closing itself through `open`, which must always succeed.
const refuseGesture = async (_data?: unknown, role?: string) => role !== 'gesture'

/**
 * A bottom sheet with a grabber that opens at a medium height and drags to full on touch, and
 * a centered dialog on mouse. Its toolbar holds the title and up to one control on each side.
 */
export function Sheet({
  open,
  title,
  onClose,
  start,
  end,
  dismissible = true,
  height = 'sheet',
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  /** Leading toolbar control, such as Reset or Cancel. */
  start?: ReactNode
  /** Trailing toolbar control, such as Done or Save (bold). */
  end?: ReactNode
  /** False keeps the sheet open through a backdrop tap or a drag down. */
  dismissible?: boolean
  /** `full` opens at the top breakpoint, for a sheet whose control needs the whole screen. */
  height?: 'sheet' | 'full'
  children: ReactNode
}) {
  const touch = usePointer() === 'touch'
  const modal = useRef<HTMLIonModalElement>(null)
  useDialogName(modal, title)
  return (
    <IonModal
      ref={modal}
      isOpen={open}
      // Ionic does not read the toolbar title, so the dialog is named here or not at all.
      aria-label={title}
      onDidDismiss={onClose}
      backdropDismiss={dismissible}
      canDismiss={dismissible ? true : refuseGesture}
      breakpoints={touch ? (height === 'full' ? [0, 1] : [0, 0.6, 1]) : undefined}
      initialBreakpoint={touch ? (height === 'full' ? 1 : 0.6) : undefined}
      handle={touch}
      className={touch ? '' : 'sheet-dialog'}
    >
      <IonHeader>
        <IonToolbar className="sheet-toolbar">
          <IonButtons slot="start">{start}</IonButtons>
          {/* Ionic clips a toolbar title to one line; a sheet's title can be a whole question,
              so it is slotted in an element that wraps. */}
          <IonTitle>
            <span className="sheet-title">{title}</span>
          </IonTitle>
          <IonButtons slot="end">{end}</IonButtons>
        </IonToolbar>
      </IonHeader>
      {touch ? (
        <IonContent className="grouped">{children}</IonContent>
      ) : (
        // IonContent contains its size, so an auto-height dialog around it collapses to the toolbar.
        <div className="sheet-dialog-body grouped">{children}</div>
      )}
    </IonModal>
  )
}
