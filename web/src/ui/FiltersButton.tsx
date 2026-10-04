import { IonButton } from '@ionic/react'
import { SlidersHorizontal } from 'lucide-react'
import { filtersLabel } from './filterCopy'

/** The control at the search row's trailing edge that opens a screen's filter sheet. */
export function FiltersButton({
  setCount,
  disabled = false,
  disabledReason,
  onOpen,
}: {
  setCount: number
  disabled?: boolean
  /** Why the control is disabled, for assistive technology; read only while disabled. */
  disabledReason?: string
  onOpen: () => void
}) {
  return (
    <IonButton
      className="toolbar-control"
      aria-label={filtersLabel(setCount)}
      disabled={disabled}
      // Always present: Ionic moves an initial aria attribute into its shadow root, after which
      // removing it from the host never reaches the button, so a cleared reason is an empty one.
      aria-description={(disabled && disabledReason) || ''}
      onClick={onOpen}
    >
      <SlidersHorizontal
        aria-hidden="true"
        className={`size-6 ${setCount > 0 ? 'fill-current' : ''}`}
      />
    </IonButton>
  )
}
