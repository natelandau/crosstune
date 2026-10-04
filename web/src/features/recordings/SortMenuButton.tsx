import { IonButton } from '@ionic/react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMenu, type MenuItem } from '../../ui/Menu'
import { nextSort, RECORDING_SORTS } from './arrangeRecordings'
import { setRecordingsSort, useRecordingsSort } from './recordingsSort'
import { SORT, SORT_LABELS, sortDirection } from './sortCopy'

/** The toolbar's sort menu for the Recordings screen; picking the current sort reverses it. */
export function SortMenuButton() {
  const current = useRecordingsSort()
  const openMenu = useMenu()
  const items: MenuItem[] = RECORDING_SORTS.map((sort) => {
    const checked = current.sort === sort
    return {
      label: SORT_LABELS[sort],
      checked,
      // Down for newest first and Z to A, up for oldest first and A to Z.
      icon: checked ? (current.descending ? ArrowDown : ArrowUp) : undefined,
      description: checked ? sortDirection(current) : undefined,
      onPress: () => setRecordingsSort(nextSort(current, sort)),
    }
  })
  return (
    <IonButton
      className="toolbar-control"
      aria-label={SORT}
      onClick={(event) => openMenu(event, SORT, items)}
    >
      <ArrowUpDown aria-hidden="true" className="size-6" />
    </IonButton>
  )
}
