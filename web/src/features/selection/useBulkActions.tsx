import { ListPlus, SquarePen, Tag } from 'lucide-react'
import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  deleteSongs,
  removeSongsFromList,
  setArchivedMany,
  updateSongs,
  type BulkPatch,
  type Undo,
} from '../../commands/bulk'
import { activeRecordingsForSong } from '../../commands/recordings'
import { useAction, type Action } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { useConfirm } from '../../ui/Confirm'
import { useMenu, type MenuItem } from '../../ui/Menu'
import { useToast } from '../../ui/Toast'
import type { CatalogEntry } from '../catalog/filters'
import { ListPicker, type ListAddition } from '../lists/ListPicker'
import { deleteSongMessage, deleteSongsMessage } from '../song/deleteSongMessage'
import { BulkEditSheet } from './BulkEditSheet'
import { countSongs } from './copy'
import type { BulkAction } from './SelectionToolbar'
import { STATUS_LABELS, STATUSES, type Instrument } from '../../constants'

/** Where the selection is being made, since a list offers one action the catalog cannot. */
export type SelectionContext =
  | { kind: 'catalog' }
  | {
      kind: 'list'
      listId: string
      listName: string
      /** The `list_items` row per selected song, which is what a removal tombstones. */
      itemIdByUserSong: ReadonlyMap<string, string>
    }

export interface BulkActionsInput {
  /** The selected songs, in screen order. */
  entries: readonly CatalogEntry[]
  instruments: ReadonlySet<Instrument>
  context: SelectionContext
  onExit: () => void
}

export interface BulkActions {
  /** The fixed slots, in the order every screen shows them. */
  actions: readonly BulkAction[]
  more: readonly MenuItem[]
  /** A failed status or More write, for the screen to show beside its toolbar. */
  error: string | null
  /** Mounted by the screen in its body. */
  sheets: ReactNode
}

type OpenSheet = 'edit' | 'list' | null

/**
 * The one place a bulk action is defined: what it is called, what it writes, what its toast
 * says, and how it is undone. A write applies to the whole selection at once and ends the
 * mode, while a failure keeps both the mode and the selection so it can be tried again.
 * Delete alone asks first and raises no toast, because it takes recordings with it that no
 * undo can bring back.
 */
export function useBulkActions({
  entries,
  instruments,
  context,
  onExit,
}: BulkActionsInput): BulkActions {
  const db = useDb()
  const toast = useToast()
  const openMenu = useMenu()
  const confirm = useConfirm()
  // Two actions, because a failed edit belongs in the sheet still holding the musician's
  // work while every other failure belongs on the screen behind it.
  const bar = useAction()
  const edit = useAction()
  const [sheet, setSheet] = useState<OpenSheet>(null)

  const ids = useMemo(() => entries.map((entry) => entry.userSong.id), [entries])
  // Keyed on the map rather than on `context`, which a screen rebuilds as a literal on every
  // render and which would leave this recomputing behind a memo that never holds.
  const itemIdByUserSong = context.kind === 'list' ? context.itemIdByUserSong : null
  const itemIds = useMemo(
    () => (itemIdByUserSong ? ids.flatMap((id) => itemIdByUserSong.get(id) ?? []) : []),
    [itemIdByUserSong, ids],
  )

  const apply = (
    action: Action,
    work: () => Promise<{ undo: Undo; message: string }>,
    onDone: () => void,
  ) => {
    action.runThen(async () => {
      const { undo, message } = await work()
      toast({ message, undo })
    }, onDone)
  }

  const statusItems: MenuItem[] = STATUSES.map((status) => ({
    label: STATUS_LABELS[status],
    onPress: () =>
      apply(
        bar,
        async () => ({
          undo: await updateSongs(db, ids, { userSong: { status } }),
          message: `Set ${countSongs(ids.length)} to ${STATUS_LABELS[status]}`,
        }),
        onExit,
      ),
  }))

  const actions: readonly BulkAction[] = [
    {
      label: 'Status',
      icon: Tag,
      // The toolbar and the footer both pass their click through, and the popover anchors to
      // it; a caller with no event to give still gets a centered menu.
      onPress: (event?: ReactMouseEvent) =>
        openMenu(event as ReactMouseEvent, 'Set status', statusItems),
    },
    {
      label: 'Edit',
      icon: SquarePen,
      onPress: () => {
        edit.clear()
        setSheet('edit')
      },
    },
    { label: 'Add to list', icon: ListPlus, onPress: () => setSheet('list') },
  ]

  // Only the songs in the opposite state, so the count names what the item will actually change.
  const archiveItem = (archive: boolean): MenuItem | null => {
    const targets = entries.filter((entry) => (entry.userSong.archived_at === null) === archive)
    if (targets.length === 0) return null
    const verb = archive ? 'Archive' : 'Unarchive'
    const count = countSongs(targets.length)
    return {
      label: `${verb} ${count}`,
      tone: 'warning',
      onPress: () =>
        apply(
          bar,
          async () => ({
            undo: await setArchivedMany(
              db,
              targets.map((entry) => entry.userSong.id),
              archive,
            ),
            message: `${verb}d ${count}`,
          }),
          onExit,
        ),
    }
  }

  // Read at press time rather than watched, because the count only has to be right for the
  // question being asked.
  const confirmDelete = async () => {
    const songIds = [...new Set(entries.map((entry) => entry.song.id))]
    const recordings = (
      await Promise.all(songIds.map((songId) => activeRecordingsForSong(db, songId)))
    ).flat()
    const files = await db.recording_files.bulkGet(recordings.map((row) => row.id))
    const views = files.map((file) => ({ file }))
    const only = entries.length === 1 ? entries[0] : undefined
    const ok = await confirm({
      title: only ? 'Delete song?' : `Delete ${countSongs(entries.length)}?`,
      message: only
        ? deleteSongMessage(only.song.title, views)
        : deleteSongsMessage(countSongs(entries.length), views),
      action: 'Delete',
    })
    if (!ok) return
    // No toast: this is the one bulk action with nothing to undo.
    bar.runThen(() => deleteSongs(db, ids), onExit)
  }

  const more: MenuItem[] = [archiveItem(true), archiveItem(false)].filter(
    (item): item is MenuItem => item !== null,
  )
  if (context.kind === 'list' && itemIds.length > 0) {
    const { listName } = context
    more.push({
      label: `Remove ${itemIds.length} from list`,
      tone: 'error',
      onPress: () =>
        apply(
          bar,
          async () => ({
            undo: await removeSongsFromList(db, itemIds),
            message: `Removed ${countSongs(itemIds.length)} from ${listName}`,
          }),
          onExit,
        ),
    })
  }

  // Absent at zero selected, where the menu still opens on `md`, so it never offers to delete
  // nothing; pending keeps a second press off a write already running.
  if (entries.length > 0 && !bar.pending) {
    more.push({
      label: `Delete ${countSongs(entries.length)}`,
      tone: 'error',
      onPress: () => void confirmDelete(),
    })
  }

  const closeSheet = (which: Exclude<OpenSheet, null>) =>
    setSheet((current) => (current === which ? null : current))

  const sheets = (
    <>
      <BulkEditSheet
        open={sheet === 'edit'}
        entries={entries}
        instruments={instruments}
        error={edit.error}
        pending={edit.pending}
        onCancel={() => closeSheet('edit')}
        onApply={(patch: BulkPatch) =>
          apply(
            edit,
            async () => ({
              undo: await updateSongs(db, ids, patch),
              message: `Edited ${countSongs(ids.length)}`,
            }),
            () => {
              setSheet(null)
              onExit()
            },
          )
        }
      />
      {/* The picker runs its own write so a failure stays in the sheet, and reports what it
          did so the toast and the undo still belong here, like every other action. */}
      <ListPicker
        open={sheet === 'list'}
        userSongIds={ids}
        excludeListId={context.kind === 'list' ? context.listId : undefined}
        onClose={() => closeSheet('list')}
        onAdded={({ undo, added, listName, created }: ListAddition) => {
          toast({
            message: created
              ? `Created ${listName} with ${countSongs(added)}`
              : `Added ${countSongs(added)} to ${listName}`,
            undo,
          })
          setSheet(null)
          onExit()
        }}
      />
    </>
  )

  return { actions, more, error: bar.error, sheets }
}
