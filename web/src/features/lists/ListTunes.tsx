import { IonList, IonReorder, IonReorderGroup, type ReorderEndCustomEvent } from '@ionic/react'
import { ArrowUpDown, GripVertical, ListX, SquarePen } from 'lucide-react'
import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type Ref } from 'react'
import type { Instrument } from '../../api/vocabulary'
import { useMenu, type MenuItem } from '../../ui/Menu'
import { useLatest } from '../../ui/useLatest'
import { TuneItem } from '../catalog/TuneItem'
import { useListSelection, type ListSelectionHost } from './useListSelection'
import type { ListItemView } from './useLists'
import { useReplayedOrder } from './useReplayedOrder'

export const MOVE_DOWN = 'Move down'
export const MOVE_TO_BOTTOM = 'Move to bottom'
export const MOVE_TO_TOP = 'Move to top'
export const MOVE_UP = 'Move up'

/** Where each menu item sends the tune, read against the rows on screen when it is pressed. */
const PLACES = {
  top: () => 0,
  up: (index: number) => index - 1,
  down: (index: number) => index + 1,
  bottom: (_index: number, last: number) => last,
} as const

/**
 * A list's tunes in their stored order, reorderable by dragging the grip or from the move menu
 * beside it. ion-reorder swallows a click on anything it holds, so the grip drags and the
 * button next to it opens the same moves for a keyboard or a screen reader.
 *
 * Selection lives here rather than on the screen, because the array it is made over is the one
 * these rows build: the stored order with every in-flight move replayed, then archived tunes
 * dropped. What the screen needs to wear its selection toolbar is published back up.
 */
export function ListTunes({
  ref,
  listId,
  items,
  showArchived,
  instruments,
  selection,
  onOpen,
  onEdit,
  onRemove,
  onMoveStart,
  onError,
}: {
  /** The rendered list, for a screen that scopes a keyboard shortcut to these rows. */
  ref?: Ref<HTMLIonListElement>
  listId: string
  /**
   * Every active item in stored order, archived ones included. It must be the array the query
   * returned, not one built again each render: a move still being written stops showing at the
   * first read after its write, and a fresh array every render reads as a fresh read, which
   * would drop the move before the screen has caught up and flash the order it had before.
   */
  items: readonly ListItemView[]
  /** Whether archived tunes show; hidden ones keep their place when others move. */
  showArchived: boolean
  instruments: ReadonlySet<Instrument>
  /** Omitted, these rows never select and the screen wears no selection toolbar. */
  selection?: ListSelectionHost
  onOpen: (tuneId: string) => void
  onEdit: (view: ListItemView) => void
  onRemove: (view: ListItemView) => void
  /** A move has begun, so the error line can drop what an earlier one left on it. */
  onMoveStart: () => void
  /** A failed move, for the page's error line. */
  onError: (message: string) => void
}) {
  const openMenu = useMenu()
  // The screen owns the forwarded ref for its own keyboard shortcut, so entering selection
  // needs a second handle on the same element to close whatever row a swipe left open.
  const list = useRef<HTMLIonListElement>(null)
  const setList = useCallback(
    (node: HTMLIonListElement | null) => {
      list.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  const { ordered, move, announcement } = useReplayedOrder({
    listId,
    items,
    onMoveStart,
    onError,
  })
  const visible = ordered.filter((view) => showArchived || view.userTune.archived_at === null)

  // The position column holds the widest number it will show, so a list that runs into three
  // digits does not step every title after row 99 inward. Tabular figures make each digit one
  // ch wide; 1.5rem is the floor a short list keeps.
  const positionWidth = `max(1.5rem, ${String(visible.length).length}ch)`

  // The rows a menu item acts on are the ones on screen when it is pressed, not when it opened.
  const onScreenRef = useLatest(visible)

  const closeOpenRow = useCallback(() => void list.current?.closeSlidingItems(), [])
  const { active, rowSelection, onClickCapture, sheets } = useListSelection({
    listId,
    items,
    visible,
    instruments,
    host: selection,
    closeOpenRow,
  })

  const moveMenu = (event: ReactMouseEvent, view: ListItemView) => {
    const index = visible.indexOf(view)
    const last = visible.length - 1
    const go = (place: (index: number, last: number) => number) => () => {
      const rows = onScreenRef.current
      const at = rows.findIndex((row) => row.item.id === view.item.id)
      if (at >= 0) move(rows, at, place(at, rows.length - 1))
    }
    const menu: MenuItem[] = [
      ...(index > 0
        ? [
            { label: MOVE_TO_TOP, onPress: go(PLACES.top) },
            { label: MOVE_UP, onPress: go(PLACES.up) },
          ]
        : []),
      ...(index < last
        ? [
            { label: MOVE_DOWN, onPress: go(PLACES.down) },
            { label: MOVE_TO_BOTTOM, onPress: go(PLACES.bottom) },
          ]
        : []),
    ]
    if (menu.length > 0) openMenu(event, `Move ${view.tune.title}`, menu)
  }

  return (
    <>
      <IonList ref={setList} onClickCapture={onClickCapture}>
        {/* A drag and a multi-select cannot share one touch gesture, so reordering stops for
            as long as the mode is on. */}
        <IonReorderGroup
          disabled={active}
          onIonReorderEnd={(event: ReorderEndCustomEvent) => {
            const { from, to } = event.detail
            // React's own order stands, so Ionic must leave the DOM alone.
            event.detail.complete(false)
            move(visible, from, to)
          }}
        >
          {visible.map((view, index) => {
            const row = rowSelection(view.userTune.id)
            return (
              <TuneItem
                key={view.item.id}
                entry={view}
                instruments={instruments}
                selection={active ? row : undefined}
                onOpen={() => onOpen(view.tune.id)}
                onLongPress={selection?.enabled ? row.onLongPress : undefined}
                start={
                  <span
                    slot="start"
                    data-position
                    className="type-subheadline text-end tabular-nums"
                    style={{ minWidth: positionWidth }}
                  >
                    {index + 1}
                  </span>
                }
                end={
                  !active && visible.length > 1 ? (
                    <>
                      {/* The menu button comes first so the grip, which the drag needs to find,
                          keeps the row's trailing edge. */}
                      <button
                        type="button"
                        aria-label={`Reorder ${view.tune.title}`}
                        className="grid size-11 place-items-center"
                        onClick={(event) => moveMenu(event, view)}
                      >
                        <ArrowUpDown aria-hidden="true" className="size-5" />
                      </button>
                      <IonReorder className="size-11 p-3">
                        <GripVertical aria-hidden="true" className="size-5" />
                      </IonReorder>
                    </>
                  ) : null
                }
                actions={
                  active
                    ? undefined
                    : [
                        {
                          label: 'Edit',
                          icon: SquarePen,
                          tone: 'neutral',
                          onPress: () => onEdit(view),
                        },
                        {
                          label: 'Remove',
                          icon: ListX,
                          tone: 'error',
                          onPress: () => onRemove(view),
                        },
                      ]
                }
              />
            )
          })}
        </IonReorderGroup>
      </IonList>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {/* Never behind the mode: a successful edit ends it while the sheet is still dismissing. */}
      {sheets}
    </>
  )
}
