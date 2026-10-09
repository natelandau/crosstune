import { renderHook } from '@testing-library/react'
import { act, useState } from 'react'
import { recordingAnalytics } from '../../analytics/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createList } from '../../commands/lists'
import { LIST_NAME_REQUIRED } from '../../commands/messages'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { useListName, type ListNameTarget } from './useListName'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function setup(initial: ListNameTarget) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const onInvalid = vi.fn()
  const analytics = recordingAnalytics()
  const view = renderHook(
    () => {
      const [target, setTarget] = useState<ListNameTarget | null>(initial)
      const form = useListName(target, {
        onSaved,
        onClose: () => {
          onClose()
          setTarget(null)
        },
        onInvalid,
      })
      return form
    },
    { wrapper: dataProviders({ db, analytics }) },
  )
  return { ...view, onSaved, onClose, onInvalid, analytics }
}

const activeNames = async () =>
  (await db.lists.toArray()).filter((list) => !list.deleted_at).map((list) => list.name)

describe('useListName', () => {
  it('refuses an empty name and says why', async () => {
    const { result, onSaved, onInvalid } = setup({ kind: 'new' })
    act(() => result.current.setName('   '))
    act(() => result.current.save())
    expect(result.current.invalid).toBe(LIST_NAME_REQUIRED)
    expect(onInvalid).toHaveBeenCalledOnce()
    expect(onSaved).not.toHaveBeenCalled()
    expect(await activeNames()).toEqual([])
    act(() => result.current.setName('Tuesday jam'))
    expect(result.current.invalid).toBeNull()
  })

  it('creates a list from a trimmed name and reports its id', async () => {
    const { result, onSaved } = setup({ kind: 'new' })
    expect(result.current.renaming).toBe(false)
    act(() => result.current.setName('  Tuesday jam '))
    act(() => result.current.save())
    await expect.poll(() => onSaved.mock.calls.length).toBe(1)
    expect(await activeNames()).toEqual(['Tuesday jam'])
    const [list] = await db.lists.toArray()
    expect(onSaved).toHaveBeenCalledWith(list!.id)
  })

  it('reports a list made from the name sheet with a count of 0', async () => {
    const { result, onSaved, analytics } = setup({ kind: 'new' })
    act(() => result.current.setName('Tuesday jam'))
    act(() => result.current.save())
    await expect.poll(() => onSaved.mock.calls.length).toBe(1)
    const [list] = await db.lists.toArray()
    expect(analytics.sends()).toEqual([
      { name: 'list_created', props: { list_id: list!.id, count_bucket: '0' } },
    ])
  })

  it('reports a rename, and nothing for a refused name', async () => {
    const listId = await createList(db, 'Tuesday jam')
    const { result, onSaved, analytics } = setup({ kind: 'rename', listId, name: 'Tuesday jam' })
    act(() => result.current.setName('  '))
    act(() => result.current.save())
    expect(analytics.sends()).toEqual([])
    act(() => result.current.setName('Square dance set'))
    act(() => result.current.save())
    await expect.poll(() => onSaved.mock.calls.length).toBe(1)
    expect(analytics.sends()).toEqual([{ name: 'list_renamed', props: { list_id: listId } }])
  })

  it('starts a rename from the current name and saves the new one', async () => {
    const listId = await createList(db, 'Tuesday jam')
    const { result, onSaved } = setup({ kind: 'rename', listId, name: 'Tuesday jam' })
    expect(result.current.name).toBe('Tuesday jam')
    expect(result.current.renaming).toBe(true)
    act(() => result.current.setName('Square dance set'))
    act(() => result.current.save())
    await expect.poll(() => onSaved.mock.calls.length).toBe(1)
    expect(await activeNames()).toEqual(['Square dance set'])
    expect(onSaved).toHaveBeenCalledWith(listId)
  })

  it('closes the target once the dismissal ends', async () => {
    const { result, onClose } = setup({ kind: 'new' })
    act(() => result.current.close())
    expect(result.current.open).toBe(false)
    act(() => result.current.dismissed())
    expect(onClose).toHaveBeenCalledOnce()
  })
})
