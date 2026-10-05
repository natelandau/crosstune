import { IonButton } from '@ionic/react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useMenu, type MenuItem } from './Menu'
import { nextSort, type SortChoice } from './sortChoice'
import { SORT, SORT_BY, sortDirection } from './sortCopy'

/** What a screen's Sort menu offers: its sorts in menu order, their names, and which are dates. */
export interface SortOptions<S extends string> {
  sorts: readonly S[]
  labels: Record<S, string>
  isDate: (sort: S) => boolean
}

// Down for newest first and Z to A, up for oldest first and A to Z.
const directionIcon = (descending: boolean) => (descending ? ArrowDown : ArrowUp)

/**
 * A list header's sort control. It shows the current sort and its direction, so the order of
 * the rows under it is never a guess, and opens the menu of sorts; picking the current sort
 * reverses it.
 */
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
      icon: checked ? directionIcon(choice.descending) : undefined,
      description: checked ? sortDirection(choice, options.isDate) : undefined,
      onPress: () => onChange(nextSort(choice, sort, options.isDate)),
    }
  })
  const label = options.labels[choice.sort]
  return (
    <IonButton
      fill="clear"
      size="small"
      className="section-action type-footnote shrink-0 normal-case [--padding-end:0] [--role-color:var(--ion-color-primary)]"
      // The visible sort leads the name, and the arrow's meaning is spoken rather than drawn.
      aria-label={`${SORT_BY} ${label}, ${sortDirection(choice, options.isDate)}`}
      onClick={(event) => openMenu(event, SORT, items)}
    >
      {label}
      {choice.descending ? (
        <ArrowDown aria-hidden="true" className="ms-1 size-4" />
      ) : (
        <ArrowUp aria-hidden="true" className="ms-1 size-4" />
      )}
    </IonButton>
  )
}
