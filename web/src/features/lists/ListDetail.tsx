import { useMemo, useState, type FormEvent } from 'react'
import { addToList, deleteList, renameList } from '../../commands/lists'
import { EmptyState } from '../../components/EmptyState'
import { useOpenRow } from '../../components/swipe'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { hideArchived } from '../catalog/filters'
import { ShowArchivedToggle } from '../catalog/ShowArchivedToggle'
import { KeepOfflineToggle } from '../recordings/KeepOfflineToggle'
import { SongSelectionActions } from '../selection/SongSelectionActions'
import { useSongSelectionMode } from '../selection/useSongSelectionMode'
import { useInstruments } from '../settings/useInstruments'
import { LIST_NAME_MAX_LENGTH } from './limits'
import { ListSongs } from './ListSongs'
import { SongPicker } from './SongPicker'
import { useListShowArchived } from './useListShowArchived'
import { useListView, type ListItemView } from './useLists'

interface Props {
  listId: string
  edit: boolean
  onEditChange: (edit: boolean) => void
  onDeleted: () => void
  selecting?: boolean
  onSelectingChange?: (selecting: boolean) => void
}

const NO_ITEMS: ListItemView[] = []
const ignore = () => {}

export function ListDetail({
  listId,
  edit,
  onEditChange,
  onDeleted,
  selecting = false,
  onSelectingChange = ignore,
}: Props) {
  const db = useDb()
  const view = useListView(listId)
  const instruments = useInstruments()
  const [showArchived, setShowArchived] = useListShowArchived()
  const { error, pending, run, runThen } = useAction()
  const rowState = useOpenRow()

  const items = view?.items ?? NO_ITEMS
  // Computed before the loading returns below, since the selection hooks must run on every render.
  const visible = useMemo(
    () => (showArchived === undefined ? NO_ITEMS : hideArchived(items, showArchived)),
    [items, showArchived],
  )
  const visibleIds = useMemo(() => visible.map((entry) => entry.userSong.id), [visible])
  // Destructured so JSX below reads plain locals rather than member expressions on an
  // object that also carries selectButtonRef, which the ref-access lint rule flags.
  const { selection, selectButtonRef, enter, exit, rowSelection } = useSongSelectionMode({
    visibleIds,
    active: selecting,
    setActive: onSelectingChange,
    // useOpenRow closes whichever row is open regardless of the id asked for.
    onEnter: () => rowState('').closeOpenRow(),
  })

  if (view === undefined || instruments === undefined || showArchived === undefined) return null
  if (view === null) return <EmptyState title="This list is gone" />
  const { list } = view
  const inList = new Set(items.map((i) => i.userSong.id))
  const selectedEntries = visible.filter((entry) => selection.isSelected(entry.userSong.id))

  return (
    <div className="space-y-4">
      {edit ? (
        <RenameForm
          initialName={list.name}
          pending={pending}
          onCancel={() => onEditChange(false)}
          onSave={(name) =>
            runThen(
              () => renameList(db, listId, name),
              () => onEditChange(false),
            )
          }
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-2xl font-bold">{list.name}</h1>
            {visible.length > 0 || selecting ? (
              <button
                ref={selectButtonRef}
                type="button"
                className={`btn min-h-11 transition-[opacity,scale] duration-(--select-bar-duration) ease-(--ease-emphasized) ${
                  selecting ? 'pointer-events-none opacity-0 motion-safe:scale-90' : ''
                }`}
                aria-hidden={selecting}
                tabIndex={selecting ? -1 : undefined}
                onClick={() => enter()}
              >
                Select
              </button>
            ) : null}
            <button
              type="button"
              className="btn min-h-11"
              disabled={selecting}
              onClick={() => onEditChange(true)}
            >
              Rename
            </button>
          </div>
          <KeepOfflineToggle listId={listId} />
        </div>
      )}

      {items.length > 0 ? (
        <ShowArchivedToggle
          checked={showArchived}
          onChange={(show) => run(() => setShowArchived(show))}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="Nothing in this list" hint="Search below to add songs." />
      ) : visible.length === 0 ? (
        <EmptyState title="Every song here is archived" hint="Turn on Show archived to see them." />
      ) : (
        <ListSongs
          listId={listId}
          items={items}
          visible={visible}
          instruments={instruments}
          runThen={runThen}
          rowState={rowState}
          selectionFor={edit ? undefined : rowSelection}
        />
      )}

      {selecting ? null : (
        <SongPicker
          excludeUserSongIds={inList}
          onPick={(id) => run(() => addToList(db, listId, id))}
        />
      )}

      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}

      {edit || selecting ? null : (
        <button
          type="button"
          className="btn btn-outline btn-error min-h-11 w-full"
          onClick={() => {
            if (!window.confirm(`Delete "${list.name}"?`)) return
            runThen(() => deleteList(db, listId), onDeleted)
          }}
        >
          Delete list
        </button>
      )}

      <SongSelectionActions
        active={selecting}
        entries={selectedEntries}
        allSelected={selection.allSelected}
        instruments={instruments}
        context={{
          kind: 'list',
          listId,
          listName: list.name,
          itemIdByUserSong: new Map(items.map((entry) => [entry.userSong.id, entry.item.id])),
        }}
        runThen={runThen}
        onToggleAll={selection.toggleAll}
        onExit={exit}
      />
    </div>
  )
}

function RenameForm({
  initialName,
  pending,
  onCancel,
  onSave,
}: {
  initialName: string
  pending: boolean
  onCancel: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(initialName)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSave(name)
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <label className="input flex-1">
        <input
          className="grow"
          aria-label="List name"
          maxLength={LIST_NAME_MAX_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-primary min-h-11" disabled={pending}>
        Save
      </button>
      <button type="button" className="btn min-h-11" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}
