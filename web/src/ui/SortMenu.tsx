import { IonButton } from '@ionic/react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMenu, type MenuItem } from './Menu'
import { nextSort, type SortChoice } from './sortChoice'
import { SORT, sortDirection } from './sortCopy'

/** What a screen's Sort menu offers: its sorts in menu order, their names, and which are dates. */
export interface SortOptions<S extends string> {
  sorts: readonly S[]
  labels: Record<S, string>
  isDate: (sort: S) => boolean
}

/** A screen's toolbar sort menu; picking the current sort reverses it. */
export function SortMenuButton<S extends string>({
  options,
  choice,
  onChange,
}: {
  options: SortOptions<S>
  choice: SortChoice<S>
  onChange: (choice: SortChoice<S>) => void
}) {
  const openMenu = useMenu()
  const items: MenuItem[] = options.sorts.map((sort) => {
    const checked = choice.sort === sort
    return {
      label: options.labels[sort],
      checked,
      // Down for newest first and Z to A, up for oldest first and A to Z.
      icon: checked ? (choice.descending ? ArrowDown : ArrowUp) : undefined,
      description: checked ? sortDirection(choice, options.isDate) : undefined,
      onPress: () => onChange(nextSort(choice, sort, options.isDate)),
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
