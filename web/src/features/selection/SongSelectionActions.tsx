import { useState, type TransitionEvent } from 'react'
import {
  addSongsToList,
  createListWithSongs,
  removeSongsFromList,
  setArchivedMany,
  updateSongs,
  type Undo,
} from '../../commands/bulk'
import { useToast } from '../../components/toastContext'
import type { Action } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import type { Instrument } from '../../db/types'
import type { CatalogEntry } from '../catalog/filters'
import { STATUS_LABELS } from '../catalog/StatusDot'
import { BatchEditSheet } from './BatchEditSheet'
import { BulkActionBar, type MoreAction } from './BulkActionBar'
import { countSongs } from './copy'
import { ListPickerSheet } from './ListPickerSheet'
import { SelectionBar } from './SelectionBar'
import { useSelectionChrome } from './selectionChrome'
import { StatusSheet } from './StatusSheet'

export type SelectionContext =
  | { kind: 'catalog' }
  | {
      kind: 'list'
      listId: string
      listName: string
      itemIdByUserSong: ReadonlyMap<string, string>
    }

export interface SongSelectionActionsProps {
  active: boolean
  /** The selected songs in screen order. */
  entries: readonly CatalogEntry[]
  allSelected: boolean
  instruments: ReadonlySet<Instrument>
  context: SelectionContext
  runThen: Action['runThen']
  onToggleAll: () => void
  onExit: () => void
}

type OpenSheet = 'status' | 'edit' | 'list' | null

export function SongSelectionActions({
  active,
  entries,
  allSelected,
  instruments,
  context,
  runThen,
  onToggleAll,
  onExit,
}: SongSelectionActionsProps) {
  const db = useDb()
  const toast = useToast()
  const [sheet, setSheet] = useState<OpenSheet>(null)
  // A sheet that just closed stays mounted until its exit transition ends.
  const [closing, setClosing] = useState(false)
  const [session, setSession] = useState(0)
  const ids = entries.map((entry) => entry.userSong.id)

  const closeSheet = () => {
    if (sheet !== null) setClosing(true)
    setSheet(null)
  }
  // Leaving selection another way, such as Back, closes the open sheet with it.
  if (!active && sheet !== null) closeSheet()

  const openSheet = (next: Exclude<OpenSheet, null>) => {
    // Remounting the Edit sheet each time it opens drops its touched fields
    // from a prior, since-closed session.
    setSession((current) => current + 1)
    setSheet(next)
  }

  const apply = (work: () => Promise<{ undo: Undo; message: string }>) => {
    // The sheet closes first so a failure's alert is not hidden behind the modal.
    closeSheet()
    runThen(async () => {
      const { undo, message } = await work()
      toast.show({ message, undo })
    }, onExit)
  }

  const archiveAction = (archive: boolean): MoreAction | null => {
    const targets = entries.filter((entry) => (entry.userSong.archived_at === null) === archive)
    if (targets.length === 0) return null
    const verb = archive ? 'Archive' : 'Unarchive'
    return {
      label: `${verb} ${countSongs(targets.length)}`,
      tone: 'warning',
      onSelect: () =>
        apply(async () => ({
          undo: await setArchivedMany(
            db,
            targets.map((entry) => entry.userSong.id),
            archive,
          ),
          message: `${verb}d ${countSongs(targets.length)}`,
        })),
    }
  }

  const more = [archiveAction(true), archiveAction(false)].filter(
    (item): item is MoreAction => item !== null,
  )
  if (context.kind === 'list') {
    const itemIds = ids.flatMap((id) => context.itemIdByUserSong.get(id) ?? [])
    more.push({
      label: `Remove ${itemIds.length} from list`,
      tone: 'danger',
      onSelect: () =>
        apply(async () => ({
          undo: await removeSongsFromList(db, itemIds),
          message: `Removed ${countSongs(itemIds.length)} from ${context.listName}`,
        })),
    })
  }

  useSelectionChrome(
    active
      ? {
          bar: (
            <SelectionBar
              count={entries.length}
              allSelected={allSelected}
              onCancel={onExit}
              onToggleAll={onToggleAll}
            />
          ),
          actions: (
            <BulkActionBar
              disabled={entries.length === 0}
              onStatus={() => openSheet('status')}
              onEdit={() => openSheet('edit')}
              onAddToList={() => openSheet('list')}
              more={more}
            />
          ),
        }
      : null,
  )

  if (!active && !closing) return null

  return (
    <div
      className="contents"
      onTransitionEnd={(event: TransitionEvent<HTMLDivElement>) => {
        if (event.target instanceof HTMLDialogElement && !event.target.open) setClosing(false)
      }}
    >
      <StatusSheet
        open={sheet === 'status'}
        entries={entries}
        onClose={closeSheet}
        onPick={(status) =>
          apply(async () => ({
            undo: await updateSongs(db, ids, { userSong: { status } }),
            message: `Set ${countSongs(ids.length)} to ${STATUS_LABELS[status]}`,
          }))
        }
      />
      <BatchEditSheet
        key={`edit-${session}`}
        open={sheet === 'edit'}
        entries={entries}
        instruments={instruments}
        onClose={closeSheet}
        onApply={(patch) =>
          apply(async () => ({
            undo: await updateSongs(db, ids, patch),
            message: `Edited ${countSongs(ids.length)}`,
          }))
        }
      />
      <ListPickerSheet
        key={`list-${session}`}
        open={sheet === 'list'}
        entries={entries}
        excludeListId={context.kind === 'list' ? context.listId : undefined}
        onClose={closeSheet}
        onAdd={(list) =>
          apply(async () => {
            const { undo, added } = await addSongsToList(db, list.id, ids)
            return { undo, message: `Added ${countSongs(added)} to ${list.name}` }
          })
        }
        onCreate={(name) =>
          apply(async () => ({
            undo: await createListWithSongs(db, name, ids),
            message: `Created ${name.trim()} with ${countSongs(ids.length)}`,
          }))
        }
      />
    </div>
  )
}
