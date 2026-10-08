import { useMemo, useState } from 'react'
import { STATUSES } from '../../api/vocabulary'
import {
  deleteTunes,
  removeTunesFromList,
  setArchivedMany,
  updateTunes,
  type BulkPatch,
  type Undo,
} from '../../commands/bulk'
import { STATUS_LABELS } from '../../constants'
import { useDb } from '../../db/DbProvider'
import { DELETE } from '../../ui/confirmCopy'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import type { MenuItem } from '../../ui/menuTypes'
import { useAction, type Action } from '../../ui/useAction'
import type { CatalogEntry } from '../catalog/filters'
import type { ListAddition } from '../lists/useListPicker'
import { deleteTunesQuestion } from '../tune/deleteTuneQuestion'
import {
  addedToListToast,
  archivedToast,
  archiveLabel,
  createdListToast,
  deleteTunesLabel,
  editedToast,
  removedFromListToast,
  removeFromListLabel,
  setStatusLabel,
} from './selectionCopy'

/** Where the selection is being made, since a list offers one action the catalog cannot. */
export type SelectionContext =
  | { kind: 'catalog' }
  | {
      kind: 'list'
      listId: string
      listName: string
      /** The `list_items` row per selected tune, which is what a removal tombstones. */
      itemIdByUserTune: ReadonlyMap<string, string>
    }

export type BulkSheet = 'edit' | 'list' | null

export interface BulkActionsOptions {
  /** The selected tunes, in screen order. */
  entries: readonly CatalogEntry[]
  context: SelectionContext
  onExit: () => void
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  toast: (message: string, undo?: () => void) => void
}

export interface BulkActionsState {
  /** The selected tunes' user tune ids, in screen order, for the list picker. */
  ids: readonly string[]
  /** One item per status, for the Set status menu. */
  statusItems: MenuItem[]
  /** Archive, Unarchive, Remove from list on a list, and Delete last. */
  more: MenuItem[]
  /** A failed status or More write, for the screen to show beside its toolbar. */
  error: string | null
  sheet: BulkSheet
  /** Opening the edit sheet drops the last edit's failure. */
  setSheet: (sheet: BulkSheet) => void
  /** Closes `which` if it is still the sheet open, so a late dismissal cannot close the next. */
  closeSheet: (which: Exclude<BulkSheet, null>) => void
  /** The edit sheet's write. A failure stays in the sheet, which holds the musician's work. */
  edit: { error: string | null; pending: boolean; apply: (patch: BulkPatch) => void }
  /** The list picker added the tunes; it ran its own write, so this only reports it. */
  listAdded: (addition: ListAddition) => void
}

/**
 * The one place a bulk action is defined: what it is called, what it writes, what its toast
 * says, and how it is undone. A write applies to the whole selection at once and ends the
 * mode, while a failure keeps both the mode and the selection so it can be tried again.
 * Delete alone asks first and raises no toast, because it takes recordings with it that no
 * undo can bring back. The caller supplies the confirmation and the toast.
 */
export function useBulkActionsWith({
  entries,
  context,
  onExit,
  confirm,
  toast,
}: BulkActionsOptions): BulkActionsState {
  const db = useDb()
  // Two actions, because a failed edit belongs in the sheet still holding the musician's
  // work while every other failure belongs on the screen behind it.
  const bar = useAction()
  const edit = useAction()
  const [sheet, setOpenSheet] = useState<BulkSheet>(null)

  const ids = useMemo(() => entries.map((entry) => entry.userTune.id), [entries])
  // Keyed on the map rather than on `context`, which a screen rebuilds as a literal on every
  // render and which would leave this recomputing behind a memo that never holds.
  const itemIdByUserTune = context.kind === 'list' ? context.itemIdByUserTune : null
  const itemIds = useMemo(
    () => (itemIdByUserTune ? ids.flatMap((id) => itemIdByUserTune.get(id) ?? []) : []),
    [itemIdByUserTune, ids],
  )

  const apply = (
    action: Action,
    work: () => Promise<{ undo: Undo; message: string }>,
    onDone: () => void,
  ) => {
    action.runThen(async () => {
      const { undo, message } = await work()
      toast(message, undo)
    }, onDone)
  }

  const statusItems: MenuItem[] = STATUSES.map((status) => ({
    label: STATUS_LABELS[status],
    onPress: () =>
      apply(
        bar,
        async () => ({
          undo: await updateTunes(db, ids, { userTune: { status } }),
          message: setStatusLabel(ids.length, status),
        }),
        onExit,
      ),
  }))

  // Only the tunes in the opposite state, so the count names what the item will actually change.
  const archiveItem = (archive: boolean): MenuItem | null => {
    const targets = entries.filter((entry) => (entry.userTune.archived_at === null) === archive)
    if (targets.length === 0) return null
    return {
      label: archiveLabel(targets.length, archive),
      tone: 'warning',
      onPress: () =>
        apply(
          bar,
          async () => ({
            undo: await setArchivedMany(
              db,
              targets.map((entry) => entry.userTune.id),
              archive,
            ),
            message: archivedToast(targets.length, archive),
          }),
          onExit,
        ),
    }
  }

  const confirmDelete = async () => {
    const ok = await confirm({ ...(await deleteTunesQuestion(db, entries)), action: DELETE })
    if (!ok) return
    // No toast: this is the one bulk action with nothing to undo.
    bar.runThen(() => deleteTunes(db, ids), onExit)
  }

  const more: MenuItem[] = [archiveItem(true), archiveItem(false)].filter(
    (item): item is MenuItem => item !== null,
  )
  if (context.kind === 'list' && itemIds.length > 0) {
    const { listName } = context
    more.push({
      label: removeFromListLabel(itemIds.length),
      tone: 'error',
      onPress: () =>
        apply(
          bar,
          async () => ({
            undo: await removeTunesFromList(db, itemIds),
            message: removedFromListToast(itemIds.length, listName),
          }),
          onExit,
        ),
    })
  }

  // Absent at zero selected, where a More menu can still open, so it never offers to delete
  // nothing; pending keeps a second press off a write already running.
  if (entries.length > 0 && !bar.pending) {
    more.push({
      label: deleteTunesLabel(entries.length),
      tone: 'error',
      onPress: () => void confirmDelete(),
    })
  }

  const setSheet = (next: BulkSheet) => {
    if (next === 'edit') edit.clear()
    setOpenSheet(next)
  }
  const closeSheet = (which: Exclude<BulkSheet, null>) =>
    setOpenSheet((current) => (current === which ? null : current))

  return {
    ids,
    statusItems,
    more,
    error: bar.error,
    sheet,
    setSheet,
    closeSheet,
    edit: {
      error: edit.error,
      pending: edit.pending,
      apply: (patch: BulkPatch) =>
        apply(
          edit,
          async () => ({
            undo: await updateTunes(db, ids, patch),
            message: editedToast(ids.length),
          }),
          () => {
            setOpenSheet(null)
            onExit()
          },
        ),
    },
    listAdded: ({ undo, added, listName, created }: ListAddition) => {
      toast(created ? createdListToast(added, listName) : addedToListToast(added, listName), undo)
      setOpenSheet(null)
      onExit()
    },
  }
}
