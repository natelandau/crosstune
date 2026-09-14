import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { addToList, deleteList, moveItem, removeFromList, renameList } from '../../commands/lists'
import { EmptyState } from '../../components/EmptyState'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { SongPicker } from './SongPicker'
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
  const { error, pending, run, runThen } = useAction()

  if (view === undefined) return null
  if (view === null) return <EmptyState title="This list is gone" />
  const { list, items } = view
  const inList = new Set(items.map((i) => i.userSong.id))

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

      {items.length === 0 ? (
        <EmptyState title="Nothing in this list" hint="Search below to add songs." />
      ) : (
        <ol className="space-y-2">
          {items.map(({ item, song }, index) => (
            <li
              key={item.id}
              className="bg-base-200 rounded-box flex min-h-14 items-center gap-2 px-3 py-2"
            >
              <span className="w-6 text-sm opacity-60">{index + 1}</span>
              <span className="badge badge-primary w-12 justify-center font-bold">
                {song.key ?? '·'}
              </span>
              <Link
                to="/songs/$id"
                params={{ id: song.id }}
                className="min-w-0 flex-1 truncate font-medium"
              >
                {song.title}
              </Link>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={index === 0}
                aria-label={`Move ${song.title} up`}
                onClick={() => run(() => moveItem(db, listId, item.id, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={index === items.length - 1}
                aria-label={`Move ${song.title} down`}
                onClick={() => run(() => moveItem(db, listId, item.id, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Remove ${song.title}`}
                onClick={() => run(() => removeFromList(db, item.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
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
