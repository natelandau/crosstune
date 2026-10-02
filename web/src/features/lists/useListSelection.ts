import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Instrument } from '../../api/vocabulary'
import type { MenuItem } from '../../ui/Menu'
import type { BulkAction } from '../selection/SelectionToolbar'
import { useBulkActions } from '../selection/useBulkActions'
import { useSelection } from '../selection/useSelection'
import type { TuneSelection } from '../selection/useTuneSelection'
import type { ListItemView } from './useLists'

/**
 * Everything the screen wears while these rows select: the mode, the count the toolbar titles
 * itself with, the bulk actions, and the controls that open and close the mode. The rows own it
 * because they own the ordered, filtered array the selection is made over.
 */
export interface ListSelectionState {
  active: boolean
  selection: TuneSelection
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

/**
 * `ids` as last returned while its contents stay the same. `ids` is built fresh every render, and
 * what reads it turns on its identity. Held as state rather than a ref: a render must not write one.
 */
function useStableIds(ids: readonly string[]): readonly string[] {
  const [last, setLast] = useState<readonly string[]>(ids)
  const same = last.length === ids.length && last.every((id, at) => id === ids[at])
  if (!same) setLast(ids)
  return same ? last : ids
}

/**
 * Selection over a list's visible rows, with the bulk actions that act on it, published up to
 * the screen that wears the toolbar.
 */
export function useListSelection({
  listId,
  items,
  visible,
  instruments,
  host,
  closeOpenRow,
}: {
  listId: string
  /** Every item, archived ones included, as the query returned them. */
  items: readonly ListItemView[]
  /** The rows on screen, in the order they show. */
  visible: readonly ListItemView[]
  instruments: ReadonlySet<Instrument>
  host: ListSelectionHost | undefined
  closeOpenRow: () => void
}): Pick<ReturnType<typeof useSelection>, 'active' | 'rowSelection' | 'onClickCapture'> & {
  sheets: ReactNode
} {
  const visibleIds = useStableIds(visible.map((view) => view.userTune.id))
  const {
    active,
    selection: tunes,
    selectRef,
    enter,
    exit,
    rowSelection,
    onClickCapture,
  } = useSelection(visibleIds, closeOpenRow)
  const { isSelected } = tunes
  // Every item, not just the visible ones, keyed by the id the selection speaks in.
  const viewByUserTune = useMemo(
    () => new Map(items.map((view) => [view.userTune.id, view])),
    [items],
  )
  // Walked in the order the list shows, so an action reads the tunes the way they read on
  // screen. Read from the ids rather than the row array, which is rebuilt every render and
  // would leave every bulk action behind this recomputing through each replayed move.
  const selected = useMemo(
    () => visibleIds.flatMap((id) => (isSelected(id) ? (viewByUserTune.get(id) ?? []) : [])),
    [visibleIds, isSelected, viewByUserTune],
  )
  // Memoized: useBulkActions keys its own memo on this map's identity.
  const itemIdByUserTune = useMemo(
    () => new Map([...viewByUserTune].map(([id, view]) => [id, view.item.id])),
    [viewByUserTune],
  )
  const bulk = useBulkActions({
    entries: selected,
    instruments,
    context: {
      kind: 'list',
      listId,
      listName: host?.listName ?? '',
      itemIdByUserTune,
    },
    onExit: exit,
  })

  // Everything the screen's toolbar reads, compared part by part. A publish carries the closures
  // of the render it ran in, so this has to name every value that changes what one of them would
  // do, including the visible ids, which toggleAll closes over.
  const digest: readonly unknown[] = [
    active,
    tunes.count,
    tunes.allSelected,
    bulk.error,
    bulk.actions.map((action) => action.label).join(','),
    bulk.more.map((item) => `${item.label}:${item.tone ?? ''}`).join(','),
    visibleIds,
  ]
  const state: ListSelectionState = {
    active,
    selection: tunes,
    actions: bulk.actions,
    more: bulk.more,
    error: bulk.error,
    enter,
    exit,
    selectRef,
  }
  const publish = host?.onChange
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

  return { active, rowSelection, onClickCapture, sheets: bulk.sheets }
}
