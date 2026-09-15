import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Sheet } from '../../components/Sheet'
import { useDb } from '../../db/DbProvider'
import type { CatalogEntry } from '../catalog/filters'
import { LIST_NAME_MAX_LENGTH } from '../lists/limits'
import { useLists } from '../lists/useLists'
import { countSongs } from './copy'

type Mark = 'none' | 'some' | 'all'

function ListMark({ mark }: { mark: Mark }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-5 shrink-0 place-items-center rounded border-2 text-xs font-bold ${
        mark === 'none' ? 'border-base-content/40' : 'border-primary'
      } ${mark === 'all' ? 'bg-primary text-primary-content' : 'text-primary'}`}
    >
      {mark === 'all' ? '✓' : mark === 'some' ? '−' : ''}
    </span>
  )
}

export function ListPickerSheet({
  open,
  entries,
  excludeListId,
  onClose,
  onAdd,
  onCreate,
}: {
  open: boolean
  entries: readonly CatalogEntry[]
  excludeListId?: string
  onClose: () => void
  onAdd: (list: { id: string; name: string }) => void
  onCreate: (name: string) => void
}) {
  const db = useDb()
  const lists = useLists() ?? []
  const members = useLiveQuery(async () => {
    const byList = new Map<string, Set<string>>()
    for (const item of await db.list_items.toArray()) {
      if (item.deleted_at) continue
      const songs = byList.get(item.list_id) ?? new Set<string>()
      songs.add(item.user_song_id)
      byList.set(item.list_id, songs)
    }
    return byList
  }, [db])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const total = entries.length

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) onCreate(name)
  }

  return (
    <Sheet open={open} title={`Add ${countSongs(total)} to a list`} onClose={onClose}>
      <ul className="flex flex-col">
        {lists
          .filter((list) => list.id !== excludeListId)
          .map((list) => {
            // Members are still loading: no count is known yet, so no mark or status shows.
            if (members === undefined) {
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    className="btn btn-ghost min-h-12 w-full justify-start text-base font-normal"
                    disabled
                  >
                    <ListMark mark="none" />
                    <span className="truncate">{list.name}</span>
                  </button>
                </li>
              )
            }
            const inList = entries.filter((entry) =>
              members.get(list.id)?.has(entry.userSong.id),
            ).length
            const mark: Mark = inList === 0 ? 'none' : inList === total ? 'all' : 'some'
            const status =
              mark === 'none'
                ? 'none in it'
                : mark === 'all'
                  ? 'all in it'
                  : `${inList} of ${total} in it`
            return (
              <li key={list.id}>
                <button
                  type="button"
                  className="btn btn-ghost min-h-12 w-full justify-start text-base font-normal"
                  disabled={mark === 'all'}
                  onClick={() => onAdd(list)}
                >
                  <ListMark mark={mark} />
                  <span className="truncate">{list.name}</span>
                  <span className="ml-auto text-sm opacity-70">{status}</span>
                </button>
              </li>
            )
          })}
      </ul>
      {creating ? (
        <form className="mt-2 flex gap-2" onSubmit={submit}>
          <label className="input flex-1">
            <input
              className="grow"
              aria-label="New list name"
              // The New list button that held focus is gone once this form replaces it.
              autoFocus
              maxLength={LIST_NAME_MAX_LENGTH}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary min-h-11" disabled={!name.trim()}>
            Create
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-ghost mt-2 min-h-11 w-full justify-start"
          onClick={() => setCreating(true)}
        >
          New list…
        </button>
      )}
      <button type="button" className="btn mt-3 min-h-11 w-full" onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  )
}
