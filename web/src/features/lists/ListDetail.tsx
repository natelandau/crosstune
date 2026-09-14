import { useState, type FormEvent } from 'react'
import { addToList, deleteList, renameList } from '../../commands/lists'
import { EmptyState } from '../../components/EmptyState'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { hideArchived } from '../catalog/filters'
import { ShowArchivedToggle } from '../catalog/ShowArchivedToggle'
import { useInstruments } from '../settings/useInstruments'
import { ListSongs } from './ListSongs'
import { SongPicker } from './SongPicker'
import { useListShowArchived } from './useListShowArchived'
import { useListView } from './useLists'

interface Props {
  listId: string
  edit: boolean
  onEditChange: (edit: boolean) => void
  onDeleted: () => void
}

export function ListDetail({ listId, edit, onEditChange, onDeleted }: Props) {
  const db = useDb()
  const view = useListView(listId)
  const instruments = useInstruments()
  const [showArchived, setShowArchived] = useListShowArchived()
  const { error, pending, run, runThen } = useAction()

  if (view === undefined || instruments === undefined || showArchived === undefined) return null
  if (view === null) return <EmptyState title="This list is gone" />
  const { list, items } = view
  const inList = new Set(items.map((i) => i.userSong.id))
  const visible = hideArchived(items, showArchived)

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
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-2xl font-bold">{list.name}</h1>
          <button type="button" className="btn min-h-11" onClick={() => onEditChange(true)}>
            Rename
          </button>
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
        />
      )}

      <SongPicker
        excludeUserSongIds={inList}
        onPick={(id) => run(() => addToList(db, listId, id))}
      />

      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}

      {edit ? null : (
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
