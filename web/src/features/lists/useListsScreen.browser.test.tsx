import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../analytics/testing'
import { addToList, createList, removeFromList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { DELETE, EDIT } from '../../ui/confirmCopy'
import { DELETE_LIST_MESSAGE } from './deleteListMessage'
import { useListsScreen } from './useListsScreen'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await createList(db, 'Tuesday jam')
})

function setup(answer: boolean) {
  const confirm = vi.fn().mockResolvedValue(answer)
  const analytics = recordingAnalytics()
  const view = renderHook(() => useListsScreen({ confirm }), {
    wrapper: dataProviders({ db, analytics }),
  })
  return { ...view, confirm, analytics }
}

const activeLists = async () => (await db.lists.toArray()).filter((list) => !list.deleted_at)

describe('useListsScreen', () => {
  it('deletes a list once the confirmation is accepted', async () => {
    const { result, confirm } = setup(true)
    await expect.poll(() => result.current.lists?.length).toBe(1)
    const list = result.current.lists![0]!
    const remove = result.current.rowActions(list).find((action) => action.label === DELETE)!
    act(() => remove.onPress())
    await expect.poll(async () => (await activeLists()).length).toBe(0)
    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      title: 'Delete "Tuesday jam"?',
      message: DELETE_LIST_MESSAGE,
      action: DELETE,
    })
  })

  it('reports a delete with the bucketed count of active items counted before it', async () => {
    const [list] = await db.lists.toArray()
    for (const title of ['A', 'B', 'C']) {
      const { userTuneId } = await createTune(db, { title }, { status: 'known' })
      const itemId = await addToList(db, list!.id, userTuneId)
      // A removed item is not active, so it must not count.
      if (title === 'C') await removeFromList(db, itemId)
    }
    const { result, analytics } = setup(true)
    await expect.poll(() => result.current.lists?.length).toBe(1)
    const remove = result.current
      .rowActions(result.current.lists![0]!)
      .find((action) => action.label === 'Delete')!
    act(() => remove.onPress())
    await expect.poll(() => analytics.sends().length).toBe(1)
    expect(analytics.sends()).toEqual([
      { name: 'list_deleted', props: { list_id: list!.id, count_bucket: '1-9' } },
    ])
  })

  it('reports an empty list deleted with a count of 0', async () => {
    const { result, analytics } = setup(true)
    await expect.poll(() => result.current.lists?.length).toBe(1)
    const remove = result.current
      .rowActions(result.current.lists![0]!)
      .find((action) => action.label === 'Delete')!
    act(() => remove.onPress())
    await expect.poll(() => analytics.sends().length).toBe(1)
    expect(analytics.sends()[0]!.props).toMatchObject({ count_bucket: '0' })
  })

  it('keeps a list whose delete is declined', async () => {
    const { result, confirm, analytics } = setup(false)
    await expect.poll(() => result.current.lists?.length).toBe(1)
    const remove = result.current
      .rowActions(result.current.lists![0]!)
      .find((action) => action.label === DELETE)!
    act(() => remove.onPress())
    await expect.poll(() => confirm.mock.calls.length).toBe(1)
    expect(await activeLists()).toHaveLength(1)
    expect(analytics.sends()).toEqual([])
  })

  it('opens the name sheet to rename from the Edit action', async () => {
    const { result } = setup(true)
    await expect.poll(() => result.current.lists?.length).toBe(1)
    const list = result.current.lists![0]!
    act(() =>
      result.current
        .rowActions(list)
        .find((action) => action.label === EDIT)!
        .onPress(),
    )
    expect(result.current.naming).toEqual({ kind: 'rename', listId: list.id, name: 'Tuesday jam' })
  })
})
