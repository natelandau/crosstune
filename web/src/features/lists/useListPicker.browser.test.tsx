import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { recordingAnalytics } from '../../usage/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { useListPicker } from './useListPicker'
import { ALL_ALREADY_IN_LIST, someAlreadyInList } from './listPickerCopy'
import { IN_THIS_LIST } from './listsCopy'

let db: CrosstuneDb
let jam: string
let dance: string
let tunes: string[]

beforeEach(async () => {
  db = openTestDb()
  jam = await createList(db, 'Tuesday jam')
  dance = await createList(db, 'Square dance set')
  tunes = []
  for (const title of ["Soldier's Joy", 'Cluck Old Hen', 'Forked Deer']) {
    tunes.push((await createTune(db, { title }, { status: 'known' })).userTuneId)
  }
})

function setup(options: { excludeListId?: string; ids?: string[] } = {}) {
  const onAdded = vi.fn()
  const onClose = vi.fn()
  const analytics = recordingAnalytics()
  const view = renderHook(
    () => useListPicker(true, options.ids ?? tunes, { ...options, onAdded, onClose }),
    {
      wrapper: dataProviders({ db, analytics }),
    },
  )
  return { ...view, onAdded, onClose, analytics }
}

/** Rows stay disabled until the membership counts have loaded. */
const loaded = (result: { current: ReturnType<typeof useListPicker> }) =>
  result.current.rows.length > 0 && result.current.rows.every((row) => !row.disabled || row.note)

const noteOf = (result: { current: ReturnType<typeof useListPicker> }, id: string) =>
  result.current.rows.find((row) => row.id === id)?.note

describe('useListPicker', () => {
  it('notes how much of the selection each list holds', async () => {
    await addToList(db, jam, tunes[0]!)
    await addToList(db, jam, tunes[1]!)
    for (const id of tunes) await addToList(db, dance, id)
    const { result } = setup()
    await expect.poll(() => noteOf(result, jam)).toBe(someAlreadyInList(2, 3))
    expect(noteOf(result, dance)).toBe(ALL_ALREADY_IN_LIST)
    const full = result.current.rows.find((row) => row.id === dance)!
    expect(full.disabled).toBe(true)
    expect(result.current.rows.find((row) => row.id === jam)!.disabled).toBe(false)
  })

  it('gives no note to a list with none of the selection', async () => {
    const { result } = setup()
    await expect.poll(() => loaded(result)).toBe(true)
    expect(noteOf(result, jam)).toBeNull()
  })

  it('says In this list, inert, for one tune a list holds, and gives no note otherwise', async () => {
    await addToList(db, jam, tunes[0]!)
    const { result } = setup({ ids: [tunes[0]!] })
    await expect.poll(() => noteOf(result, jam)).toBe(IN_THIS_LIST)
    expect(result.current.rows.find((row) => row.id === jam)!.disabled).toBe(true)
    expect(noteOf(result, dance)).toBeNull()
    expect(result.current.rows.find((row) => row.id === dance)!.disabled).toBe(false)
  })

  it('leaves the excluded list off', async () => {
    const { result } = setup({ excludeListId: jam })
    await expect.poll(() => result.current.rows.map((row) => row.id)).toEqual([dance])
  })

  it('adds the selection to a list, closes, and reports the addition', async () => {
    const { result, onAdded } = setup()
    await expect.poll(() => loaded(result)).toBe(true)
    act(() => result.current.add(jam))
    await expect.poll(() => onAdded.mock.calls.length).toBe(1)
    expect(onAdded).toHaveBeenCalledWith(
      expect.objectContaining({ added: 3, listName: 'Tuesday jam', created: false }),
    )
    expect(result.current.closing).toBe(true)
    const items = await db.list_items.where('list_id').equals(jam).toArray()
    expect(items).toHaveLength(3)
  })

  it('creates a list from a trimmed name and adds the selection to it', async () => {
    const { result, onAdded } = setup()
    act(() => result.current.setCreating(true))
    act(() => result.current.setName('  New set '))
    act(() => result.current.create())
    await expect.poll(() => onAdded.mock.calls.length).toBe(1)
    expect(onAdded).toHaveBeenCalledWith(
      expect.objectContaining({ added: 3, listName: 'New set', created: true }),
    )
  })

  it('reports tunes added to an existing list with the number actually added', async () => {
    await addToList(db, jam, tunes[0]!)
    const { result, onAdded, analytics } = setup()
    await expect.poll(() => noteOf(result, jam)).toBe(someAlreadyInList(1, 3))
    act(() => result.current.add(jam))
    await expect.poll(() => onAdded.mock.calls.length).toBe(1)
    expect(analytics.sends()).toEqual([
      { name: 'tunes_added_to_list', props: { list_id: jam, count_bucket: '1-9' } },
    ])
  })

  it('reports a list made with tunes as one list_created and no tunes_added_to_list', async () => {
    const { result, onAdded, analytics } = setup()
    act(() => result.current.setName('New set'))
    act(() => result.current.create())
    await expect.poll(() => onAdded.mock.calls.length).toBe(1)
    const created = (await db.lists.toArray()).find((list) => list.name === 'New set')!
    expect(analytics.sends()).toEqual([
      { name: 'list_created', props: { list_id: created.id, count_bucket: '1-9' } },
    ])
  })

  it('reports nothing when the undo of a list made with tunes runs', async () => {
    const { result, onAdded, analytics } = setup()
    act(() => result.current.setName('New set'))
    act(() => result.current.create())
    await expect.poll(() => onAdded.mock.calls.length).toBe(1)
    await act(async () => onAdded.mock.lastCall![0].undo())
    expect(analytics.sends().map((send) => send.name)).toEqual(['list_created'])
  })

  it('ignores a create with no name', async () => {
    const { result, onAdded } = setup()
    act(() => result.current.setName('  '))
    act(() => result.current.create())
    expect(onAdded).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('reports a dismissal', async () => {
    const { result, onClose } = setup()
    act(() => result.current.dismissed())
    expect(onClose).toHaveBeenCalledOnce()
  })
})
