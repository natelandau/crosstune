import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createList } from '../../commands/lists'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { DELETE } from '../../ui/confirmCopy'
import { DELETE_LIST_MESSAGE } from './deleteListMessage'
import { useListsScreen } from './useListsScreen'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await createList(db, 'Tuesday jam')
})

function setup(answer: boolean) {
  const confirm = vi.fn().mockResolvedValue(answer)
  const view = renderHook(() => useListsScreen({ confirm }), {
    wrapper: dataProviders({ db }),
  })
  return { ...view, confirm }
}

const activeLists = async () => (await db.lists.toArray()).filter((list) => !list.deleted_at)

describe('useListsScreen', () => {
  it('deletes a list once the confirmation is accepted', async () => {
    const { result, confirm } = setup(true)
    await expect.poll(() => result.current.lists?.length).toBe(1)
    const list = result.current.lists![0]!
    const remove = result.current.rowActions(list).find((action) => action.label === 'Delete')!
    act(() => remove.onPress())
    await expect.poll(async () => (await activeLists()).length).toBe(0)
    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      title: 'Delete "Tuesday jam"?',
      message: DELETE_LIST_MESSAGE,
      action: DELETE,
    })
  })

  it('keeps a list whose delete is declined', async () => {
    const { result, confirm } = setup(false)
    await expect.poll(() => result.current.lists?.length).toBe(1)
    const remove = result.current
      .rowActions(result.current.lists![0]!)
      .find((action) => action.label === 'Delete')!
    act(() => remove.onPress())
    await expect.poll(() => confirm.mock.calls.length).toBe(1)
    expect(await activeLists()).toHaveLength(1)
  })

  it('opens the name sheet to rename from the Edit action', async () => {
    const { result } = setup(true)
    await expect.poll(() => result.current.lists?.length).toBe(1)
    const list = result.current.lists![0]!
    act(() =>
      result.current
        .rowActions(list)
        .find((action) => action.label === 'Edit')!
        .onPress(),
    )
    expect(result.current.naming).toEqual({ kind: 'rename', listId: list.id, name: 'Tuesday jam' })
  })
})
