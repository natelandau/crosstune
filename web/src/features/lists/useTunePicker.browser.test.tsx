import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { recordingAnalytics } from '../../analytics/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { useTunePicker } from './useTunePicker'

vi.mock('../../commands/lists', { spy: true })

let db: CrosstuneDb
let listId: string
let joy: string
let hen: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  joy = (await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })).userTuneId
  hen = (await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })).userTuneId
})

function setup(open = true) {
  const toast = vi.fn()
  const analytics = recordingAnalytics()
  const view = renderHook(({ open }) => useTunePicker(open, listId, { toast }), {
    wrapper: dataProviders({ db, analytics }),
    initialProps: { open },
  })
  return { ...view, toast, analytics }
}

const itemsIn = async () =>
  (await db.list_items.where('list_id').equals(listId).toArray()).filter((i) => !i.deleted_at)

describe('useTunePicker', () => {
  it('marks a tune already in the list as taken', async () => {
    await addToList(db, listId, joy)
    const { result } = setup()
    await expect.poll(() => [...result.current.taken]).toEqual([joy])
    act(() => result.current.setQuery('soldier'))
    await expect
      .poll(() => result.current.matches.matches.map((entry) => entry.userTune.id))
      .toEqual([joy])
    expect(result.current.taken.has(joy)).toBe(true)
  })

  it('reads no catalog while closed, and reads it once open', async () => {
    const { result, rerender } = setup(false)
    await expect.poll(() => result.current.taken.size).toBe(0)
    expect(result.current.matches.entries).toBeUndefined()
    rerender({ open: true })
    await expect.poll(() => result.current.matches.entries?.length).toBe(2)
  })

  it('adds a picked tune, clears the search, and stays open', async () => {
    const { result } = setup()
    act(() => result.current.setQuery('cluck'))
    await expect.poll(() => result.current.matches.matches.length).toBe(1)
    act(() => result.current.pick(hen))
    expect(result.current.query).toBe('')
    await expect.poll(async () => (await itemsIn()).map((i) => i.user_tune_id)).toEqual([hen])
    await expect.poll(() => result.current.taken.has(hen)).toBe(true)
    expect(result.current.closing).toBe(false)
  })

  it('reports the visit once, with every tune added, when the picker closes', async () => {
    const { result, analytics } = setup()
    act(() => result.current.pick(joy))
    act(() => result.current.pick(hen))
    await expect.poll(async () => (await itemsIn()).length).toBe(2)
    await expect.poll(() => result.current.taken.size).toBe(2)
    expect(analytics.sends()).toEqual([])
    act(() => void result.current.dismissed())
    expect(analytics.sends()).toEqual([
      { name: 'tunes_added_to_list', props: { list_id: listId, count_bucket: '1-9' } },
    ])
  })

  it('waits for an add still running at dismissal, and reports nothing for a failed one', async () => {
    const { result, analytics, toast } = setup()
    let settle = () => {}
    vi.mocked(addToList).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          settle = () => resolve('item')
        }),
    )
    act(() => result.current.pick(joy))
    act(() => void result.current.dismissed())
    expect(analytics.sends()).toEqual([])
    settle()
    await expect.poll(() => analytics.sends().length).toBe(1)

    vi.mocked(addToList).mockRejectedValueOnce(new Error('Disk full'))
    act(() => result.current.pick(hen))
    act(() => void result.current.dismissed())
    // The rejection is toasted in the same turn that releases the add and runs the report check.
    await expect.poll(() => toast.mock.calls.length).toBe(1)
    expect(analytics.sends()).toHaveLength(1)
  })

  it('reports an add that finishes after a reopen with its own visit', async () => {
    const { result, rerender, analytics } = setup()
    let settle = () => {}
    vi.mocked(addToList).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          settle = () => resolve('item')
        }),
    )
    act(() => result.current.pick(joy))
    act(() => void result.current.dismissed())
    rerender({ open: false })
    rerender({ open: true })
    settle()
    await expect.poll(() => analytics.sends().length).toBe(1)

    act(() => result.current.pick(hen))
    await expect.poll(async () => (await itemsIn()).map((i) => i.user_tune_id)).toEqual([hen])
    await expect.poll(() => result.current.taken.has(hen)).toBe(true)
    act(() => void result.current.dismissed())
    expect(analytics.sends()).toEqual([
      { name: 'tunes_added_to_list', props: { list_id: listId, count_bucket: '1-9' } },
      { name: 'tunes_added_to_list', props: { list_id: listId, count_bucket: '1-9' } },
    ])
  })

  it('offers to create a tune by the typed title', async () => {
    const { result } = setup()
    act(() => result.current.setQuery('Kesh Jig'))
    await expect
      .poll(() => result.current.matches.outcome)
      .toEqual({ kind: 'create', title: 'Kesh Jig', another: false })
  })

  it('closes on create and hands the title back once dismissed', async () => {
    const { result } = setup()
    act(() => result.current.create('Kesh Jig'))
    expect(result.current.closing).toBe(true)
    let title: string | null = null
    act(() => {
      title = result.current.dismissed()
    })
    expect(title).toBe('Kesh Jig')
    act(() => {
      title = result.current.dismissed()
    })
    expect(title).toBeNull()
  })

  it('toasts a failed add that outlives its visit', async () => {
    const { result, rerender, toast } = setup()
    vi.mocked(addToList).mockRejectedValueOnce(new Error('Disk full'))
    act(() => result.current.pick(joy))
    act(() => void result.current.dismissed())
    rerender({ open: false })
    await expect.poll(() => toast.mock.calls.length).toBe(1)
    expect(toast).toHaveBeenCalledWith('Disk full')
  })
})
