import { useIonViewWillLeave } from '@ionic/react'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { usePointer } from '../../platform/pointer'
import { isTextEntry, overlayOpen, visibleMain } from '../../ui/useShortcut'
import { selectionCheckboxId } from './ids'
import { useSongSelection, type SongSelection } from './useSongSelection'

export interface RowSelection {
  selected: boolean
  onToggle: () => void
  onLongPress: () => void
}

export interface Selection {
  active: boolean
  selection: SongSelection
  /** Names the control that leaves the mode, so focus can return to it. */
  selectRef: (node: HTMLElement | null) => void
  enter: (focusId?: string) => void
  exit: () => void
  rowSelection: (userSongId: string) => RowSelection
  /**
   * Belongs on the element the rows sit in. A row's open handler takes no event, so a
   * shift-click is caught on the way down to it and extends the range from here instead; every
   * screen that lists rows gets ranges by attaching this rather than by writing its own.
   */
  onClickCapture: (event: ReactMouseEvent) => void
}

// Below Ionic's overlays (100) and above its router (0), so Back closes a sheet, then leaves
// selection, then leaves the screen.
const BACK_PRIORITY = 50

// Longer than a menu takes to dismiss, so an overlay that stays up for its own reasons stops
// being waited on rather than being waited on forever.
const MENU_FRAMES = 60

interface BackButtonDetail {
  register: (priority: number, handler: (next?: () => void) => void) => void
}

/**
 * An Ionic control keeps its focusable element inside its shadow root and leaves the host
 * itself unfocusable, so focusing the host alone would go nowhere.
 */
function focusTargetIn(node: HTMLElement): HTMLElement {
  return node.shadowRoot?.querySelector<HTMLElement>('button, a, input') ?? node
}

/**
 * Selection mode for a screen of song rows: whether it is on, which rows are in it, where focus
 * goes as it opens and closes, the keyboard, and the hardware back button.
 *
 * `visibleIds` must be memoized by the caller: `selectAll` depends on its identity. `onEnter`
 * runs before the mode opens, for a caller with an open swipe row to close first.
 */
export function useSelection(visibleIds: readonly string[], onEnter?: () => void): Selection {
  const [active, setActive] = useState(false)
  const selection = useSongSelection(visibleIds, active)
  const focusTarget = useRef<string | null>(null)
  const buttonRef = useRef<HTMLElement | null>(null)
  const mouse = usePointer() === 'mouse'

  // A focused control that unmounts sends no blur, so focus would be stranded on a node the
  // page no longer holds.
  const selectRef = useCallback((node: HTMLElement | null) => {
    if (node === null && buttonRef.current && document.activeElement === buttonRef.current) {
      visibleMain()?.focus({ preventScroll: true })
    }
    buttonRef.current = node
  }, [])

  const wasActive = useRef(active)
  useEffect(() => {
    if (wasActive.current === active) return
    wasActive.current = active
    if (active) {
      const id = focusTarget.current ?? visibleIds[0]
      focusTarget.current = null
      if (id) document.getElementById(selectionCheckboxId(id))?.focus()
      return
    }
    // Where focus goes is decided as the mode ends: the control it opened from if the screen
    // still has one, and the page otherwise. The control sits at the top of the screen, and
    // scrolling back up to it would lose the reader's place.
    const control = buttonRef.current
    // The wait is capped rather than cancelled: it has to outlive the rows it was started from,
    // since on a screen whose rows own the mode the action that ends it can take them with it.
    let frames = 0
    const land = () => {
      if (frames++ > MENU_FRAMES) return
      // A menu the action was chosen from holds the keyboard in its trap and leaves the rest of
      // the screen inert until it has finished dismissing, so a move made before then does not
      // land; Ionic then hands focus back to the control it saved as the menu opened, which an
      // action that ends the mode has usually taken away, leaving focus on the body.
      if (overlayOpen()) {
        requestAnimationFrame(land)
        return
      }
      if (control?.isConnected) focusTargetIn(control).focus({ preventScroll: true })
      else visibleMain()?.focus({ preventScroll: true })
      // An Ionic control just put back on the screen has no shadow root yet, so its inner
      // button is not there to take focus until a frame later.
      if (document.activeElement === null || document.activeElement === document.body) {
        requestAnimationFrame(land)
      }
    }
    land()
  }, [active, visibleIds])

  const exit = useCallback(() => setActive(false), [])
  const { selectAll, toggleRange } = selection

  const onClickCapture = useCallback(
    (event: ReactMouseEvent) => {
      if (!active || !event.shiftKey) return
      const open = (event.target as HTMLElement).closest('[data-row-open]')
      const id = visibleIds.find((rowId) => open?.id === selectionCheckboxId(rowId))
      if (id === undefined) return
      event.stopPropagation()
      toggleRange(id)
    },
    [active, toggleRange, visibleIds],
  )

  useEffect(() => {
    if (!active || !mouse) return
    const onKey = (event: KeyboardEvent) => {
      if (isTextEntry(event.target) || overlayOpen()) return
      if (event.key === 'Escape') {
        exit()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        // Never toggleAll: the one key that means "everything" must not also mean "nothing".
        selectAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, exit, mouse, selectAll])

  useEffect(() => {
    if (!active) return
    const handle = (event: Event) => {
      const { detail } = event as CustomEvent<BackButtonDetail>
      // The handler never calls next, which is what keeps Back from popping the page as well.
      detail.register(BACK_PRIORITY, () => exit())
    }
    document.addEventListener('ionBackButton', handle)
    return () => document.removeEventListener('ionBackButton', handle)
  }, [active, exit])

  useIonViewWillLeave(() => setActive(false))

  const enter = (focusId?: string) => {
    onEnter?.()
    focusTarget.current = focusId ?? null
    setActive(true)
  }

  const rowSelection = (userSongId: string): RowSelection => ({
    selected: selection.isSelected(userSongId),
    onToggle: () => selection.toggle(userSongId),
    onLongPress: () => {
      // The held row joins the selection as the mode opens, which holds because entering
      // never clears the set.
      selection.toggle(userSongId)
      enter(userSongId)
    },
  })

  return { active, selection, selectRef, enter, exit, rowSelection, onClickCapture }
}
