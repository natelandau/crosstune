import { IonButton, IonFooter, IonToolbar } from '@ionic/react'
import { useEffect, type ReactElement } from 'react'
import { getMode } from '../../platform/mode'
import { useMenu, type MenuItem } from '../../ui/Menu'
import { useSelectionChrome } from './SelectionProvider'
import type { BulkAction } from './SelectionToolbar'
import type { SongSelection } from './useSongSelection'

export interface SelectionFooterProps {
  selection: SongSelection
  actions: readonly BulkAction[]
  more: readonly MenuItem[]
}

/**
 * The bar of bulk actions Apple puts along the bottom in edit mode, where the tab bar was.
 * md has no such bar: its actions ride in the contextual toolbar and the bottom navigation
 * stays. Mounted only while a screen selects, so it is also what raises and lowers the flag
 * that hides the tab bar.
 */
export function SelectionFooter({
  selection,
  actions,
  more,
}: SelectionFooterProps): ReactElement | null {
  const { setSelecting } = useSelectionChrome()
  const openMenu = useMenu()
  const ios = getMode() === 'ios'

  useEffect(() => {
    if (!ios) return
    setSelecting(true)
    return () => setSelecting(false)
  }, [ios, setSelecting])

  if (!ios) return null

  const disabled = selection.count === 0
  return (
    <IonFooter>
      <IonToolbar>
        <div className="flex items-center justify-between px-2">
          {actions.map((action) => (
            <IonButton
              key={action.label}
              className="toolbar-control"
              fill="clear"
              disabled={disabled}
              onClick={action.onPress}
            >
              {action.label}
            </IonButton>
          ))}
          <IonButton
            className="toolbar-control"
            fill="clear"
            disabled={disabled || more.length === 0}
            onClick={(event) => openMenu(event, 'More actions', [...more])}
          >
            More
          </IonButton>
        </div>
      </IonToolbar>
    </IonFooter>
  )
}
