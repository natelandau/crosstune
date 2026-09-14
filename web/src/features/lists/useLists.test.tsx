import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activeItems,
  addToList,
  createList,
  moveItem,
  removeFromList,
  renameList,
} from '../../commands/lists'
import { createSong } from '../../commands/songs'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { useLists } from './useLists'

const OLD = '2020-01-01T00:00:00.000Z'

let db: CrosstuneDb
let listId: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  for (const title of ['Angeline', 'Bill Cheatham']) {
    const { userSongId } = await createSong(db, { title }, { status: 'known' })
    await addToList(db, listId, userSongId)
  }
  await db.lists.update(listId, { updated_at: OLD })
  await db.list_items.where('list_id').equals(listId).modify({ updated_at: OLD })
})

afterEach(async () => {
  await db.delete()
})

function wrapper({ children }: { children: ReactNode }) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}

async function renderLists() {
  const { result } = renderHook(() => useLists(), { wrapper })
  await waitFor(() => expect(result.current).toBeDefined())
  return result
}

describe('useLists', () => {
  it('counts active items and reports the newest edit', async () => {
    const result = await renderLists()
    expect(result.current?.[0]).toMatchObject({ count: 2, lastEditedAt: OLD })
  })

  it.each([
    ['a rename', () => renameList(db, listId, 'Thursday jam')],
    [
      'an added song',
      async () => {
        const { userSongId } = await createSong(
          db,
          { title: 'Cumberland Gap' },
          { status: 'known' },
        )
        await addToList(db, listId, userSongId)
      },
    ],
    [
      'a removed song',
      async () => {
        const [first] = await activeItems(db, listId)
        await removeFromList(db, first!.id)
      },
    ],
    [
      'a reorder',
      async () => {
        const [first] = await activeItems(db, listId)
        await moveItem(db, listId, first!.id, 1)
      },
    ],
  ])('moves the last edit on %s', async (_name, edit) => {
    const result = await renderLists()
    await edit()
    await waitFor(() => expect(result.current?.[0]?.lastEditedAt).not.toBe(OLD))
  })

  it('keeps a removed item out of the count', async () => {
    const result = await renderLists()
    const [first] = await activeItems(db, listId)
    await removeFromList(db, first!.id)
    await waitFor(() => expect(result.current?.[0]?.count).toBe(1))
  })
})
