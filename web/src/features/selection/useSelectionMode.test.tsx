import { act, renderHook } from '@testing-library/react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteTunes } from '../../commands/bulk'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { useCatalog } from '../catalog/useCatalog'
import { useSelectionMode } from './useSelectionMode'

const IDS = ['a', 'b', 'c']

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { cancelable: true, ...init })

function setup(onEnter?: () => void) {
  return renderHook(({ ids }) => useSelectionMode(ids, { onEnter }), {
    initialProps: { ids: IDS },
  })
}

describe('useSelectionMode', () => {
  it('opens with the first id selected, after onEnter runs', () => {
    const activeAtEnter: boolean[] = []
    const { result } = setup(() => activeAtEnter.push(result.current.active))
    act(() => result.current.enter('b'))
    expect(result.current.active).toBe(true)
    expect(activeAtEnter).toEqual([false])
    expect([...result.current.selected]).toEqual(['b'])
  })

  it('opens empty without a first id and clears on exit', () => {
    const { result } = setup()
    act(() => result.current.enter())
    expect(result.current.selected.size).toBe(0)
    act(() => result.current.toggle('a'))
    act(() => result.current.exit())
    expect(result.current.active).toBe(false)
    expect(result.current.selected.size).toBe(0)
  })

  it('extends a range from the last toggled id', () => {
    const { result } = setup()
    act(() => result.current.enter('a'))
    act(() => result.current.range('c'))
    expect([...result.current.selected].sort()).toEqual(IDS)
  })

  it('selects all on Cmd-A twice and never clears', () => {
    const { result } = setup()
    act(() => result.current.enter())
    const first = key({ key: 'a', metaKey: true })
    act(() => result.current.onKeyDown(first))
    expect(first.defaultPrevented).toBe(true)
    act(() => result.current.onKeyDown(key({ key: 'a', metaKey: true })))
    expect(result.current.selected.size).toBe(3)
    act(() => result.current.onKeyDown(key({ key: 'A', ctrlKey: true })))
    expect(result.current.selected.size).toBe(3)
  })

  it('leaves Cmd-A typed in a field to the field', () => {
    const { result } = setup()
    act(() => result.current.enter())
    const preventDefault = vi.fn()
    const input = document.createElement('input')
    act(() =>
      result.current.onKeyDown({
        key: 'a',
        metaKey: true,
        ctrlKey: false,
        target: input,
        preventDefault,
      }),
    )
    expect(preventDefault).not.toHaveBeenCalled()
    expect(result.current.selected.size).toBe(0)
  })

  it('leaves on Escape', () => {
    const { result } = setup()
    act(() => result.current.enter('a'))
    act(() => result.current.onKeyDown(key({ key: 'Escape' })))
    expect(result.current.active).toBe(false)
  })

  it('ignores keys while it is off', () => {
    const { result } = setup()
    const event = key({ key: 'a', metaKey: true })
    act(() => result.current.onKeyDown(event))
    expect(event.defaultPrevented).toBe(false)
    expect(result.current.selected.size).toBe(0)
  })

  it('leaves a plain A alone', () => {
    const { result } = setup()
    act(() => result.current.enter())
    const event = key({ key: 'a' })
    act(() => result.current.onKeyDown(event))
    expect(event.defaultPrevented).toBe(false)
    expect(result.current.selected.size).toBe(0)
  })
})

describe('useSelectionMode over the catalog', () => {
  let db: CrosstuneDb

  beforeEach(() => {
    db = openTestDb()
  })

  function useCatalogSelection() {
    const entries = useCatalog()
    const ids = useMemo(() => entries?.map((entry) => entry.userTune.id) ?? [], [entries])
    return { ids, mode: useSelectionMode(ids) }
  }

  it('drops a selected tune deleted from the db', async () => {
    const joy = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    const hen = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    const { result } = renderHook(useCatalogSelection, { wrapper: dataProviders({ db }) })
    await expect.poll(() => result.current.ids.length).toBe(2)
    act(() => result.current.mode.enter(joy.userTuneId))
    act(() => result.current.mode.toggle(hen.userTuneId))
    expect(result.current.mode.selected.size).toBe(2)

    await deleteTunes(db, [joy.userTuneId])

    await expect.poll(() => [...result.current.mode.selected]).toEqual([hen.userTuneId])
    expect(result.current.mode.active).toBe(true)
  })
})
