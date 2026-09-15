import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { createList, deleteList } from '../../commands/lists'
import { EmptyState } from '../../components/EmptyState'
import { SwipeRow } from '../../components/SwipeRow'
import { useOpenRow } from '../../components/swipe'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { LIST_NAME_MAX_LENGTH } from './limits'
import { ListRow } from './ListRow'
import { useLists } from './useLists'

export function ListsScreen() {
  const db = useDb()
  const lists = useLists()
  const [name, setName] = useState('')
  const { error, run, runThen } = useAction()
  const navigate = useNavigate()
  const rowState = useOpenRow()

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    runThen(
      () => createList(db, name),
      () => setName(''),
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Lists</h1>
      <form onSubmit={handleCreate} className="flex gap-2">
        <label className="input flex-1">
          <input
            className="grow"
            aria-label="New list name"
            placeholder="Tuesday jam, square dance set, ..."
            maxLength={LIST_NAME_MAX_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary min-h-11" disabled={!name.trim()}>
          Create list
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}
      {lists === undefined ? null : lists.length === 0 ? (
        <EmptyState
          title="No lists yet"
          hint="A list is an ordered set of songs, like a setlist."
        />
      ) : (
        <ul className="space-y-2">
          {lists.map((list) => (
            <li key={list.id}>
              <SwipeRow
                name={list.name}
                {...rowState(list.id)}
                actions={[
                  {
                    label: 'Edit',
                    tone: 'neutral',
                    onPress: () =>
                      void navigate({
                        to: '/lists/$id',
                        params: { id: list.id },
                        search: { edit: true },
                        state: { editPushed: true },
                      }),
                  },
                  {
                    label: 'Delete',
                    tone: 'error',
                    onPress: () => {
                      if (window.confirm(`Delete "${list.name}"?`)) {
                        run(() => deleteList(db, list.id))
                      }
                    },
                  },
                ]}
              >
                <ListRow list={list} />
              </SwipeRow>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
