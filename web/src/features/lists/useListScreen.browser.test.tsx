import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { recordingAnalytics } from '../../analytics/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activeItems, addToList, createList, removeFromList } from '../../commands/lists'
import { createTune, setArchived } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList } from '../../db/types'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { SHOW_ARCHIVED } from '../catalog/catalogCopy'
import { DELETE_LIST_MESSAGE } from './deleteListMessage'
import { DELETE_LIST, HIDE_ARCHIVED } from './listsCopy'
import { useListScreen } from './useListScreen'

vi.mock('../../commands/lists', { spy: true })

let db: CrosstuneDb
let listId: string
let joy: string
let hen: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  joy = (await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })).userTuneId
  hen = (await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })).userTuneId
})

function setup(id = listId, answer = true) {
  const confirm = vi.fn().mockResolvedValue(answer)
  const leave = vi.fn()
  const analytics = recordingAnalytics()
  const view = renderHook(() => useListScreen(id, { confirm, leave }), {
    wrapper: dataProviders({ db, analytics }),
  })
  return { ...view, confirm, leave, analytics }
}

describe('useListScreen', () => {
  it('confirms a list delete, then leaves once the row is gone', async () => {
    await addToList(db, listId, joy)
    const { result, confirm, leave } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    // Read when leave fires, so a leave that runs before the write lands fails the test.
    let seen: Promise<LocalList | undefined> | undefined
    leave.mockImplementation(() => {
      seen = db.lists.get(listId)
    })
    act(() => result.current.removeList())
    await expect.poll(() => leave.mock.calls.length).toBe(1)
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete "Tuesday jam"?', message: DELETE_LIST_MESSAGE }),
    )
    expect((await seen)?.deleted_at).toBeTruthy()
    expect(result.current.notFound).toBe(false)
  })

  it('reports a delete with the active items counted before it', async () => {
    await addToList(db, listId, joy)
    await addToList(db, listId, hen)
    const { result, leave, analytics } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.removeList())
    await expect.poll(() => leave.mock.calls.length).toBe(1)
    expect(analytics.sends()).toEqual([
      { name: 'list_deleted', props: { list_id: listId, count_bucket: '1-9' } },
    ])
  })

  it('reports a removed tune once, and an add nothing', async () => {
    await addToList(db, listId, joy)
    const { result, analytics } = setup()
    await expect.poll(() => result.current.items?.length).toBe(1)
    const item = result.current.items![0]!
    await act(async () => {
      await Promise.all([result.current.remove(item), result.current.remove(item)])
    })
    expect(analytics.sends()).toEqual([
      { name: 'tunes_removed_from_list', props: { list_id: listId, count_bucket: '1-9' } },
    ])
    await act(() => result.current.add(hen))
    await expect
      .poll(async () => (await activeItems(db, listId)).map((entry) => entry.user_tune_id))
      .toEqual([hen])
    expect(analytics.sends()).toHaveLength(1)
  })

  it('does not leave when the delete is declined', async () => {
    const { result, confirm, leave } = setup(listId, false)
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.removeList())
    await expect.poll(() => confirm.mock.calls.length).toBe(1)
    expect(leave).not.toHaveBeenCalled()
    expect((await db.lists.get(listId))?.deleted_at).toBeFalsy()
  })

  it('reports a list that does not exist', async () => {
    const { result } = setup('nope')
    await expect.poll(() => result.current.notFound).toBe(true)
    expect(result.current.list).toBeNull()
  })

  it('tracks what is in the list and adds and removes tunes', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    expect(result.current.emptyKind).toBe('empty')
    await act(() => result.current.add(joy))
    await expect.poll(() => [...result.current.taken]).toEqual([joy])
    expect(result.current.emptyKind).toBeNull()
    await act(() => result.current.remove(result.current.items![0]!))
    await expect.poll(() => result.current.taken.size).toBe(0)
  })

  it('removes a tune once for two presses in one tick', async () => {
    await addToList(db, listId, joy)
    const { result } = setup()
    await expect.poll(() => result.current.items?.length).toBe(1)
    const item = result.current.items![0]!
    vi.mocked(removeFromList).mockClear()
    await act(async () => {
      await Promise.all([result.current.remove(item), result.current.remove(item)])
    })
    expect(removeFromList).toHaveBeenCalledOnce()
    await expect.poll(() => result.current.taken.size).toBe(0)
  })

  it('says every tune is archived while archived tunes are hidden', async () => {
    await addToList(db, listId, hen)
    await setArchived(db, hen, true)
    const { result } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    expect(result.current.emptyKind).toBe('allArchived')
    await act(() => result.current.setShowArchived(true))
    await expect.poll(() => result.current.emptyKind).toBeNull()
    expect(result.current.visibleCount).toBe(1)
  })

  it('words the archived item from the setting and offers Select only on request', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    const plain = result.current.menuItems({})
    expect(plain.map((item) => item.label)).toEqual(['Rename', SHOW_ARCHIVED, DELETE_LIST])
    const onSelect = vi.fn()
    const selectable = result.current.menuItems({ onSelect })
    expect(selectable[0]!.label).toBe('Select')
    selectable[0]!.onPress()
    expect(onSelect).toHaveBeenCalledOnce()
    await act(() => result.current.setShowArchived(true))
    await expect
      .poll(() => result.current.menuItems({}).map((item) => item.label))
      .toContain(HIDE_ARCHIVED)
  })

  it('opens the rename sheet from the menu', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    act(() =>
      result.current
        .menuItems({})
        .find((item) => item.label === 'Rename')!
        .onPress(),
    )
    expect(result.current.naming).toEqual({ kind: 'rename', listId, name: 'Tuesday jam' })
  })
})
