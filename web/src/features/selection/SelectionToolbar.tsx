import { IonButton } from '@ionic/react'
import { Ellipsis, X, type LucideIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { getMode } from '../../platform/mode'
import { useMenu, type MenuItem } from '../../ui/Menu'
import type { SongSelection } from './useSongSelection'

export interface BulkAction {
  label: string
  icon: LucideIcon
  onPress: () => void
}

export interface SelectionToolbarInput {
  selection: SongSelection
  actions: readonly BulkAction[]
  more: readonly MenuItem[]
  onExit: () => void
}

// A screen swaps its own toolbar controls for these. React unwraps an unkeyed top-level
// fragment and then matches the two sets of controls position by position, reusing each button
// and leaving an earlier control's name on a later one; a key of their own is what stops it, and
// it belongs here so a screen that spreads these parts is safe without knowing any of it.
const START_KEY = 'selection-start'
const END_KEY = 'selection-end'

export interface SelectionToolbarParts {
  start: ReactNode
  /** The count and the word beside it, as two parts, so only the word can be elided. */
  title: ReactNode
  /** For `Screen`'s `titleClass`, so a count that grows a digit never reflows the bar. */
  titleClass: string
  end: ReactNode
}

/**
 * The toolbar a screen wears while it selects, as the three parts `Screen` slots separately.
 * iOS takes Apple's edit mode: Select All leads, the count is the title, Done trails, and the
 * actions wait in a footer. md takes Material's contextual action bar: the count leads behind
 * a cancel control and the actions sit in the bar itself.
 */
export function useSelectionToolbar({
  selection,
  actions,
  more,
  onExit,
}: SelectionToolbarInput): SelectionToolbarParts {
  const openMenu = useMenu()
  const { count, allSelected, toggleAll } = selection
  const ios = getMode() === 'ios'
  const word = ios ? 'Selected' : 'selected'
  const spoken = `${count} ${word}`
  // Two parts rather than one string: the count says what every action beside it will act on,
  // so a bar with no room for the whole label elides the word and never a digit.
  const title = (
    <span className="selection-title-text">
      <span className="selection-title-count">{count}</span>{' '}
      <span className="selection-title-word">{word}</span>
    </span>
  )
  const announcement = (
    <p aria-live="polite" className="sr-only">
      {/* The region stays and its text is replaced, which is what a reader announces. */}
      <span key={count} className="tabular-nums">
        {spoken}
      </span>
    </p>
  )

  if (ios) {
    return {
      title,
      titleClass: 'tabular-nums',
      start: (
        <Fragment key={START_KEY}>
          {announcement}
          <IonButton className="toolbar-control" onClick={toggleAll}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </IonButton>
        </Fragment>
      ),
      end: (
        <Fragment key={END_KEY}>
          <IonButton className="toolbar-control" onClick={onExit}>
            Done
          </IonButton>
        </Fragment>
      ),
    }
  }

  const items: MenuItem[] = [
    { label: allSelected ? 'Deselect all' : 'Select all', onPress: toggleAll },
    ...more,
  ]
  return {
    title,
    titleClass: 'tabular-nums',
    start: (
      <Fragment key={START_KEY}>
        {announcement}
        <IonButton className="toolbar-control" aria-label="Cancel selection" onClick={onExit}>
          <X aria-hidden="true" className="size-5" />
        </IonButton>
      </Fragment>
    ),
    end: (
      <Fragment key={END_KEY}>
        {actions.map((action) => (
          <IonButton
            key={action.label}
            className="toolbar-control"
            aria-label={action.label}
            disabled={count === 0}
            onClick={action.onPress}
          >
            <action.icon aria-hidden="true" className="size-6" />
          </IonButton>
        ))}
        {/* Live at any count: Select all lives in here, and the mode always opens at zero. */}
        <IonButton
          className="toolbar-control"
          aria-label="More actions"
          onClick={(event) => openMenu(event, 'More actions', items)}
        >
          <Ellipsis aria-hidden="true" className="size-6" />
        </IonButton>
      </Fragment>
    ),
  }
}
