import { IonButtons, IonContent, IonHeader, IonModal, IonTitle, IonToolbar } from '@ionic/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { usePointer } from '../platform/pointer'

// A role-less dismiss is the sheet closing itself through `open`, which must always succeed.
const refuseGesture = async (_data?: unknown, role?: string) => role !== 'gesture'

/**
 * Keep the dialog named for the title it is showing now. ion-modal reads `aria-label` from its
 * host once, while it loads, copies it onto the element inside its shadow root that carries
 * `role="dialog"`, and takes the attribute off the host; it never reads the host again. A title
 * that counts what a screen has selected therefore names the dialog for the count the sheet
 * first rendered with, which is before anything is selected. The `aria-label` prop below is
 * where that first name comes from, and this puts every later title in its place.
 *
 * Ionic's own re-renders, for a breakpoint or a present, leave the name alone: Stencil skips
 * writing an attribute whose value has not changed, and the value it holds never changes.
 */
function useDialogName(modal: React.RefObject<HTMLIonModalElement | null>, title: string): void {
  useEffect(() => {
    const element = modal.current
    if (!element) return
    let live = true
    // The element carries componentOnReady once Ionic has defined it, and its shadow root holds
    // nothing before then.
    void Promise.resolve(element.componentOnReady?.()).then(() => {
      if (!live) return
      element.shadowRoot?.querySelector('[role="dialog"]')?.setAttribute('aria-label', title)
    })
    return () => {
      live = false
    }
  }, [modal, title])
}

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
      breakpoints={touch ? [0, 0.6, 1] : undefined}
      initialBreakpoint={touch ? 0.6 : undefined}
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
