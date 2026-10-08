import { useMemo, useState } from 'react'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import {
  useBulkActionsWith,
  type BulkActionsState,
  type SelectionContext,
} from '../selection/useBulkActionsWith'
import { useSelectionMode, type SelectionMode } from '../selection/useSelectionMode'
import type { ListItemView } from './useLists'

export interface ListSelection {
  /** The visible rows' user tune ids, stable while their order holds. */
  visibleIds: readonly string[]
  mode: SelectionMode
  /** The selected rows, in the order the list shows them. */
  selected: readonly ListItemView[]
  context: SelectionContext
  bulk: BulkActionsState
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
 * Selection over a list's visible rows, with the bulk actions that act on it. The caller
 * supplies the confirmation and the toast.
 */
export function useListSelection({
  listId,
  listName,
  items,
  visible,
  closeOpenRow,
  confirm,
  toast,
}: {
  listId: string
  /** Named in the toast a bulk action raises. */
  listName: string
  /** Every item, archived ones included, as the query returned them. */
  items: readonly ListItemView[]
  /** The rows on screen, in the order they show. */
  visible: readonly ListItemView[]
  closeOpenRow?: () => void
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  toast: (message: string, undo?: () => void) => void
}): ListSelection {
  const visibleIds = useStableIds(visible.map((view) => view.userTune.id))
  const mode = useSelectionMode(visibleIds, { onEnter: closeOpenRow })
  const { isSelected } = mode.selection
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
  // Memoized: useBulkActionsWith keys its own memo on this map's identity.
  const itemIdByUserTune = useMemo(
    () => new Map([...viewByUserTune].map(([id, view]) => [id, view.item.id])),
    [viewByUserTune],
  )
  const context: SelectionContext = { kind: 'list', listId, listName, itemIdByUserTune }
  const bulk = useBulkActionsWith({
    entries: selected,
    context,
    onExit: mode.exit,
    confirm,
    toast,
  })
  return { visibleIds, mode, selected, context, bulk }
}
