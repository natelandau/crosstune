import { activeItems, moveItem } from '../../commands/lists'
import { useDb } from '../../db/DbProvider'
import { storedPlayFirst } from '../../db/types'
import type { PlayFirst } from '../../api/vocabulary'
import type { MenuItem } from '../../ui/menuTypes'
import { movedAnnouncement } from '../../ui/reorderCopy'
import { useLatest } from '../../ui/useLatest'
import { useScanTuneIds } from '../scans/useScans'
import { useSettingsRow } from '../settings/useSettingsRow'
import { moveMenuItems } from '../../ui/moveMenu'
import type { ListItemView } from './useLists'
import { listShows } from './useListShowArchived'
import { useReplayedOrder } from './useReplayedOrder'

const itemIdOf = (view: ListItemView) => view.item.id

export interface ListTunes {
  /** The rows on screen: stored order with every move in flight replayed, archived ones dropped. */
  visible: ListItemView[]
  /** Send the visible row at `fromIndex` to `toIndex`, showing it there at once and writing it behind. */
  move: (fromIndex: number, toIndex: number) => void
  /** The moves that apply to `entry`, the visible row at `index`. */
  moveItems: (entry: ListItemView, index: number) => MenuItem[]
  /** What the last move said it did, for a status line. */
  announcement: string
  /** The user's play-first choice, undefined until the settings row has been read. */
  playFirst: PlayFirst | undefined
  /** Tunes with scans, for the row's scan marker. */
  scanTunes: ReadonlySet<string>
}

/**
 * A list's tunes in their stored order with moves shown before the store holds them.
 * `items` must be the array the query returned, not one built again each render: a fresh
 * array every render reads as a fresh read, which would drop a move before the screen has
 * caught up and flash the order it had before.
 */
export function useListTunes({
  listId,
  items,
  showArchived,
  onMoveStart,
  onError,
}: {
  listId: string
  items: readonly ListItemView[]
  /** Whether archived tunes show; hidden ones keep their place when others move. */
  showArchived: boolean
  /** A move has begun, so an error line can drop what an earlier one left on it. */
  onMoveStart?: () => void
  onError: (message: string) => void
}): ListTunes {
  const db = useDb()
  const settings = useSettingsRow()
  const playFirst = settings === undefined ? undefined : storedPlayFirst(settings)
  const scanTunes = useScanTuneIds()
  const { ordered, move, announcement } = useReplayedOrder({
    items,
    idOf: itemIdOf,
    write: (itemId, targetId) => moveItem(db, listId, itemId, targetId),
    readOrder: async () => (await activeItems(db, listId)).map((item) => item.id),
    announce: (rows, from, to) => movedAnnouncement(rows[from]!.tune.title, to + 1, rows.length),
    onMoveStart,
    onError,
  })
  const visible = ordered.filter((view) => listShows(view, showArchived))
  // The rows a menu item acts on are the ones on screen when it is pressed, not when it opened.
  const onScreenRef = useLatest(visible)

  const moveItems = (entry: ListItemView, index: number) =>
    moveMenuItems(index, visible.length, (place) => () => {
      const rows = onScreenRef.current
      const at = rows.findIndex((row) => row.item.id === entry.item.id)
      if (at >= 0) move(rows, at, place(at, rows.length - 1))
    })

  return {
    visible,
    move: (fromIndex, toIndex) => move(visible, fromIndex, toIndex),
    moveItems,
    announcement,
    playFirst,
    scanTunes,
  }
}
