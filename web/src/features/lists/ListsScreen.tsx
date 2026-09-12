import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { createList } from '../../commands/lists'
import { EmptyState } from '../../components/EmptyState'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { useLists } from './useLists'

export function ListsScreen() {
  const db = useDb()
  const lists = useLists()
  const [name, setName] = useState('')
  const { error, runThen } = useAction()

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
              <Link
                to="/lists/$id"
                params={{ id: list.id }}
                className="bg-base-200 rounded-box flex min-h-14 items-center justify-between px-3 py-2"
              >
                <span className="font-medium">{list.name}</span>
                <span className="text-sm opacity-70">
                  {list.count} {list.count === 1 ? 'song' : 'songs'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
