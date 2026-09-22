import { IonList, IonReorder, IonReorderGroup, type ReorderEndCustomEvent } from '@ionic/react'
import { ArrowUpDown, GripVertical, ListX, SquarePen } from 'lucide-react'
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from 'react'
import { activeItems, moveItem } from '../../commands/lists'
import { useDb } from '../../db/DbProvider'
import { useMenu, type MenuItem } from '../../ui/Menu'
import { SongItem } from '../catalog/SongItem'
import type { BulkAction } from '../selection/SelectionToolbar'
import { useBulkActions } from '../selection/useBulkActions'
import { useSelection } from '../selection/useSelection'
import type { SongSelection } from '../selection/useSongSelection'
import { placeBeside } from './order'
import type { ListItemView } from './useLists'
import type { Instrument } from '../../api/vocabulary'

interface Move {
  itemId: string
  targetId: string
  /** Which side of the target the song was sent to, decided once, when the move was made. */
  side: 'before' | 'after'
}

interface Pending {
  move: Move
  /** The items on screen, and the order the store held, when this move's write settled. */
  settled?: { items: readonly ListItemView[]; order: readonly string[] }
}

// Replaying a side rather than a direction is what makes this safe to run twice: an order that
// already holds the move comes back unchanged, so a read landing mid-flight cannot flip it back.
const apply = (order: readonly string[], move: Move): string[] =>
  placeBeside(order, (id) => id, move.itemId, move.targetId, move.side)

/**
 * Whether two orders agree, comparing only the items both carry. A list view drops an item whose
 * song rows have not arrived yet, which a read of the stored order still counts, so one list is
 * a superset of the other across a sync page boundary.
 */
const sameOrder = (a: readonly string[], b: readonly string[]): boolean => {
  const inB = new Set(b)
  const inA = new Set(a)
  const left = a.filter((id) => inB.has(id))
  const right = b.filter((id) => inA.has(id))
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/**
 * A move is replayed onto the stored order until its own write settles and the first read after
 * that decides, the rule usePendingWrite follows, including its second half: a read that landed
 * before the write settled decides straight away, which the order the store held just after the
 * write answers. Nothing is inferred from the order alone, because a song beside its target says
 * nothing about which move put it there. A move whose song or target has left the list stops
 * early, having nothing left to say.
 */
const replaying = (
  pending: Pending,
  order: readonly string[],
  items: readonly ListItemView[],
): boolean =>
  order.includes(pending.move.itemId) &&
  order.includes(pending.move.targetId) &&
  (pending.settled === undefined ||
    (pending.settled.items === items && !sameOrder(order, pending.settled.order)))

/**
 * Everything the screen wears while these rows select: the mode, the count the toolbar titles
 * itself with, the bulk actions, and the controls that open and close the mode. The rows own it
 * because they own the ordered, filtered array the selection is made over.
 */
export interface ListSelectionState {
  active: boolean
  selection: SongSelection
  actions: readonly BulkAction[]
  more: readonly MenuItem[]
  /** A failed bulk write, for the screen's error line. */
  error: string | null
  enter: () => void
  exit: () => void
  /** Names the control the mode opens from, so focus can return to it. */
  selectRef: (node: HTMLElement | null) => void
}

/** How a screen hosts selection over these rows. */
export interface ListSelectionHost {
  /** Named in the toast a bulk action raises. */
  listName: string
  /** False while a sheet owns the screen, so a long press cannot open the mode behind it. */
  enabled: boolean
  onChange: (state: ListSelectionState | null) => void
}

/** Where each menu item sends the song, read against the rows on screen when it is pressed. */
const PLACES = {
  top: () => 0,
  up: (index: number) => index - 1,
  down: (index: number) => index + 1,
  bottom: (_index: number, last: number) => last,
} as const

/**
 * A list's songs in their stored order, reorderable by dragging the grip or from the move menu
 * beside it. ion-reorder swallows a click on anything it holds, so the grip drags and the
 * button next to it opens the same moves for a keyboard or a screen reader.
 *
 * Selection lives here rather than on the screen, because the array it is made over is the one
 * these rows build: the stored order with every in-flight move replayed, then archived songs
 * dropped. What the screen needs to wear its selection toolbar is published back up.
 */
export function ListSongs({
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
  /** Whether archived songs show; hidden ones keep their place when others move. */
  showArchived: boolean
  instruments: ReadonlySet<Instrument>
  /** Omitted, these rows never select and the screen wears no selection toolbar. */
  selection?: ListSelectionHost
  onOpen: (songId: string) => void
  onEdit: (view: ListItemView) => void
  onRemove: (view: ListItemView) => void
  /** A move has begun, so the error line can drop what an earlier one left on it. */
  onMoveStart: () => void
  /** A failed move, for the page's error line. */
  onError: (message: string) => void
}) {
  const db = useDb()
  const openMenu = useMenu()
  const [announcement, setAnnouncement] = useState('')
  const [moving, setMoving] = useState<readonly Pending[]>([])
  const writes = useRef(Promise.resolve())
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

  // Every move still in flight is replayed onto the order the store holds, in the order they
  // were made, which is the order the store applies them in. A failed move drops out and the
  // moves after it land where the store puts them, with no later read to correct.
  const storedOrder = items.map((view) => view.item.id)
  const inFlight = moving.filter((pending) => replaying(pending, storedOrder, items))
  if (inFlight.length !== moving.length) setMoving(inFlight)
  const order = inFlight.reduce((current, pending) => apply(current, pending.move), storedOrder)

  const byId = new Map(items.map((view) => [view.item.id, view]))
  const ordered = order.flatMap((id) => byId.get(id) ?? [])
  const visible = ordered.filter((view) => showArchived || view.userSong.archived_at === null)

  // The position column holds the widest number it will show, so a list that runs into three
  // digits does not step every title after row 99 inward. Tabular figures make each digit one
  // ch wide; 1.5rem is the floor a short list keeps.
  const positionWidth = `max(1.5rem, ${String(visible.length).length}ch)`

  // The rows a menu item acts on are the ones on screen when it is pressed, not when it opened.
  const onScreen = useRef(visible)
  // A layout effect runs in the same task as the commit, so a write that settles later always
  // finds the items that are on screen, never an older read.
  const shownItems = useRef(items)
  useLayoutEffect(() => {
    onScreen.current = visible
    shownItems.current = items
  })

  // `visible` is a fresh array every render, and both useSelection's selectAll and the toolbar
  // published below turn on the identity of the ids, so the last array is kept until the ids in
  // it actually change. Held as state rather than a ref: a render must not write one.
  const ids = visible.map((view) => view.userSong.id)
  const [lastIds, setLastIds] = useState<readonly string[]>(ids)
  const sameIds = lastIds.length === ids.length && lastIds.every((id, at) => id === ids[at])
  if (!sameIds) setLastIds(ids)
  const visibleIds = sameIds ? lastIds : ids
  const closeOpenRow = useCallback(() => void list.current?.closeSlidingItems(), [])
  const {
    active,
    selection: songs,
    selectRef,
    enter,
    exit,
    rowSelection,
    onClickCapture,
  } = useSelection(visibleIds, closeOpenRow)
  const { isSelected } = songs
  // Every item, not just the visible ones, keyed by the id the selection speaks in.
  const viewByUserSong = useMemo(
    () => new Map(items.map((view) => [view.userSong.id, view])),
    [items],
  )
  // Walked in the order the list shows, so an action reads the songs the way they read on
  // screen. Read from the ids rather than the row array, which is rebuilt every render and
  // would leave every bulk action behind this recomputing through each replayed move.
  const selected = useMemo(
    () => visibleIds.flatMap((id) => (isSelected(id) ? (viewByUserSong.get(id) ?? []) : [])),
    [visibleIds, isSelected, viewByUserSong],
  )
  // Memoized: useBulkActions keys its own memo on this map's identity.
  const itemIdByUserSong = useMemo(
    () => new Map(items.map((view) => [view.userSong.id, view.item.id])),
    [items],
  )
  const bulk = useBulkActions({
    entries: selected,
    instruments,
    context: {
      kind: 'list',
      listId,
      listName: selection?.listName ?? '',
      itemIdByUserSong,
    },
    onExit: exit,
  })

  // Everything the screen's toolbar reads, compared part by part. A publish carries the closures
  // of the render it ran in, so this has to name every value that changes what one of them would
  // do, including the visible ids, which toggleAll closes over.
  const digest: readonly unknown[] = [
    active,
    songs.count,
    songs.allSelected,
    bulk.error,
    bulk.actions.map((action) => action.label).join(','),
    bulk.more.map((item) => `${item.label}:${item.tone ?? ''}`).join(','),
    visibleIds,
  ]
  const state: ListSelectionState = {
    active,
    selection: songs,
    actions: bulk.actions,
    more: bulk.more,
    error: bulk.error,
    enter,
    exit,
    selectRef,
  }
  const publish = selection?.onChange
  const published = useRef<readonly unknown[] | null>(null)
  useLayoutEffect(() => {
    const last = published.current
    if (
      !publish ||
      (last && last.length === digest.length && last.every((v, at) => v === digest[at]))
    )
      return
    published.current = digest
    publish(state)
  })
  // The screen's toolbar outlives these rows, so it has to hear when the last one goes. Forgetting
  // what was published with it is what lets the next mount publish again, which a StrictMode
  // double-invoke depends on: the ref survives the remount it simulates, the state does not.
  useLayoutEffect(
    () => () => {
      published.current = null
      publish?.(null)
    },
    [publish],
  )

  const move = (rows: readonly ListItemView[], from: number, to: number) => {
    const song = rows[from]
    const target = rows[to]
    if (!song || !target || from === to) return
    // A hidden archived song keeps its place because the target is a visible neighbor.
    const next: Pending = {
      move: {
        itemId: song.item.id,
        targetId: target.item.id,
        side: from < to ? 'after' : 'before',
      },
    }
    const said = `Moved ${song.song.title} to position ${to + 1} of ${rows.length}`
    setAnnouncement(said)
    onMoveStart()
    setMoving((current) => [...current, next])
    writes.current = writes.current
      .then(() => moveItem(db, listId, next.move.itemId, next.move.targetId))
      .then(
        async () => {
          // Read before the await, or a commit landing inside it would leave these two
          // describing different moments and neither of them able to retire the move.
          const shown = shownItems.current
          const stored = await activeItems(db, listId).then(
            (rows) => rows.map((item) => item.id),
            () => null,
          )
          setMoving((current) =>
            stored === null
              ? // The write landed, so the store holds the move. With no read to say when the
                // screen catches up, following the store now beats waiting on an answer that
                // is not coming.
                current.filter((queued) => queued !== next)
              : current.map((queued) =>
                  queued === next
                    ? { ...queued, settled: { items: shown, order: stored } }
                    : queued,
                ),
          )
        },
        (caught: unknown) => {
          setMoving((current) => current.filter((queued) => queued !== next))
          // The song is back where it was, so this move's announcement would still claim it moved.
          setAnnouncement((current) => (current === said ? '' : current))
          onError(caught instanceof Error ? caught.message : 'Something went wrong')
        },
      )
  }

  const moveMenu = (event: ReactMouseEvent, view: ListItemView) => {
    const index = visible.indexOf(view)
    const last = visible.length - 1
    const go = (place: (index: number, last: number) => number) => () => {
      const rows = onScreen.current
      const at = rows.findIndex((row) => row.item.id === view.item.id)
      if (at >= 0) move(rows, at, place(at, rows.length - 1))
    }
    const menu: MenuItem[] = [
      ...(index > 0
        ? [
            { label: 'Move to top', onPress: go(PLACES.top) },
            { label: 'Move up', onPress: go(PLACES.up) },
          ]
        : []),
      ...(index < last
        ? [
            { label: 'Move down', onPress: go(PLACES.down) },
            { label: 'Move to bottom', onPress: go(PLACES.bottom) },
          ]
        : []),
    ]
    if (menu.length > 0) openMenu(event, `Move ${view.song.title}`, menu)
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
            const row = rowSelection(view.userSong.id)
            return (
              <SongItem
                key={view.item.id}
                entry={view}
                instruments={instruments}
                selection={active ? row : undefined}
                onOpen={() => onOpen(view.song.id)}
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
                        aria-label={`Reorder ${view.song.title}`}
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
      {bulk.sheets}
    </>
  )
}
