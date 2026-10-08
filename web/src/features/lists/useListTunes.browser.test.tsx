import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import { createTune, setArchived } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { MOVE_DOWN, MOVE_TO_BOTTOM, MOVE_TO_TOP, MOVE_UP } from './moveMenu'
import { useListView } from './useLists'
import { useListTunes } from './useListTunes'

let db: CrosstuneDb
let listId: string
const titles = ['Angeline the Baker', "Soldier's Joy", 'Cluck Old Hen', 'Forked Deer']
const userTuneIds: string[] = []

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  userTuneIds.length = 0
  for (const title of titles) {
    const { userTuneId } = await createTune(db, { title }, { status: 'known' })
    userTuneIds.push(userTuneId)
    await addToList(db, listId, userTuneId)
  }
})

function setup(showArchived = false) {
  const onError = vi.fn()
  const view = renderHook(
    () => {
      const list = useListView(listId)
      const tunes = useListTunes({
        listId,
        items: list?.items ?? [],
        showArchived,
        onError,
      })
      return { ready: list !== undefined && list !== null, tunes }
    },
    { wrapper: dataProviders({ db }) },
  )
  return { ...view, onError }
}

const shown = (result: { current: ReturnType<typeof setup>['result']['current'] }) =>
  result.current.tunes.visible.map((view) => view.tune.title)

const order = async () =>
  (await db.list_items.where('list_id').equals(listId).toArray())
    .filter((item) => !item.deleted_at)
    .sort((a, b) => (a.position < b.position ? -1 : 1))
    .map((item) => item.user_tune_id)

describe('useListTunes', () => {
  it('moves a row, shows it at once, and announces the position', async () => {
    const { result } = setup()
    await expect.poll(() => shown(result)).toEqual(titles)
    act(() => result.current.tunes.move(0, 2))
    expect(shown(result)).toEqual([titles[1], titles[2], titles[0], titles[3]])
    expect(result.current.tunes.announcement).toBe('Moved Angeline the Baker to position 3 of 4')
    await expect
      .poll(order)
      .toEqual([userTuneIds[1], userTuneIds[2], userTuneIds[0], userTuneIds[3]])
  })

  it('offers only the moves that go somewhere', async () => {
    const { result } = setup()
    await expect.poll(() => shown(result)).toEqual(titles)
    const [first, , , last] = result.current.tunes.visible
    expect(result.current.tunes.moveItems(first!, 0).map((item) => item.label)).toEqual([
      MOVE_DOWN,
      MOVE_TO_BOTTOM,
    ])
    expect(result.current.tunes.moveItems(last!, 3).map((item) => item.label)).toEqual([
      MOVE_TO_TOP,
      MOVE_UP,
    ])
  })

  it('moves to the bottom from its menu item', async () => {
    const { result } = setup()
    await expect.poll(() => shown(result)).toEqual(titles)
    const first = result.current.tunes.visible[0]!
    act(() =>
      result.current.tunes
        .moveItems(first, 0)
        .find((i) => i.label === MOVE_TO_BOTTOM)!
        .onPress(),
    )
    expect(shown(result).at(-1)).toBe(titles[0])
  })

  it('drops archived tunes from view unless they show', async () => {
    await setArchived(db, userTuneIds[1]!, true)
    const hidden = setup()
    await expect.poll(() => shown(hidden.result)).toEqual([titles[0], titles[2], titles[3]])
    const all = setup(true)
    await expect.poll(() => shown(all.result)).toEqual(titles)
  })
})
