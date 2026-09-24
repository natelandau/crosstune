import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeItems,
  addToList,
  createList,
  moveItem,
  removeFromList,
  renameList,
} from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { useLists, useMembershipCounts } from './useLists'

const OLD = '2020-01-01T00:00:00.000Z'

let db: CrosstuneDb
let listId: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  for (const title of ['Angeline', 'Bill Cheatham']) {
    const { userTuneId } = await createTune(db, { title }, { status: 'known' })
    await addToList(db, listId, userTuneId)
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
      'an added tune',
      async () => {
        const { userTuneId } = await createTune(
          db,
          { title: 'Cumberland Gap' },
          { status: 'known' },
        )
        await addToList(db, listId, userTuneId)
      },
    ],
    [
      'a removed tune',
      async () => {
        const [first] = await activeItems(db, listId)
        await removeFromList(db, first!.id)
      },
    ],
    [
      'a reorder',
      async () => {
        const [first, second] = await activeItems(db, listId)
        await moveItem(db, listId, first!.id, second!.id)
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

async function renderCounts(ids: string[]) {
  const { result, rerender } = renderHook(
    ({ ids }: { ids: string[] }) => useMembershipCounts(ids),
    {
      wrapper,
      initialProps: { ids },
    },
  )
  await waitFor(() => expect(result.current).toBeDefined())
  return { result, rerender }
}

describe('useMembershipCounts', () => {
  it('counts how many of the given tunes a list holds', async () => {
    const { userTuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    const { result } = await renderCounts([userTuneId])
    expect(result.current?.get(listId)).toBeUndefined()
    await addToList(db, listId, userTuneId)
    await waitFor(() => expect(result.current?.get(listId)).toBe(1))
  })

  it('drops a removed item from the count', async () => {
    const [first] = await activeItems(db, listId)
    const { result } = await renderCounts([first!.user_tune_id])
    await waitFor(() => expect(result.current?.get(listId)).toBe(1))
    await removeFromList(db, first!.id)
    await waitFor(() => expect(result.current?.get(listId)).toBeUndefined())
  })

  it('does not requery when a new array carries the same ids', async () => {
    const [first] = await activeItems(db, listId)
    const spy = vi.spyOn(db.list_items, 'where')
    const { result, rerender } = await renderCounts([first!.user_tune_id])
    await waitFor(() => expect(result.current?.get(listId)).toBe(1))
    const callsAfterFirst = spy.mock.calls.length
    // A fresh array holding the same id, as an unmemoized caller would pass on every render.
    rerender({ ids: [first!.user_tune_id] })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(spy.mock.calls.length).toBe(callsAfterFirst)
  })
})
