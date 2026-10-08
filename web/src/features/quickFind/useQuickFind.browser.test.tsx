import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import type { QuickFindCommand } from './quickFindResults'
import { useQuickFind } from './useQuickFind'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
  await createList(db, 'Thursday jam')
})

function setup(commands: QuickFindCommand[] = [], open = false) {
  const onChoose = vi.fn()
  const view = renderHook(({ open }) => useQuickFind(open, { commands, onChoose }), {
    wrapper: dataProviders({ db }),
    initialProps: { open },
  })
  return { ...view, onChoose }
}

const titlesIn = (sections: ReturnType<typeof useQuickFind>['sections']) =>
  sections.flatMap((section) => section.items.map((item) => item.title))

describe('useQuickFind', () => {
  it('reads the catalog, lists, and recordings only while open', async () => {
    const { result, rerender } = setup([], true)
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.setQuery('j'))
    await expect
      .poll(() => titlesIn(result.current.sections))
      .toEqual(["Soldier's Joy", 'Thursday jam'])

    rerender({ open: false })
    await expect.poll(() => result.current.ready).toBe(false)
    act(() => result.current.setQuery('j'))
    expect(result.current.sections).toEqual([])
  })

  it('opens a second step in place, and hands a choice over', async () => {
    const title = { id: 'title', label: 'Title', run: vi.fn() }
    const sort = { id: 'sort', label: 'Sort by', step: { title: 'Sort by', choices: [title] } }
    const { result, onChoose } = setup([sort], true)
    act(() => result.current.setQuery('sort'))
    await expect.poll(() => titlesIn(result.current.sections)).toEqual(['Sort by'])

    act(() => result.current.run(result.current.sections[0]!.items[0]!))
    expect(result.current.query).toBe('')
    expect(result.current.step).toBe('Sort by')
    expect(titlesIn(result.current.sections)).toEqual(['Title'])
    expect(onChoose).not.toHaveBeenCalled()

    act(() => result.current.run(result.current.sections[0]!.items[0]!))
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ title: 'Title' }))
  })

  it('steps back out of a second step to the query it left', async () => {
    const sort = {
      id: 'sort',
      label: 'Sort by',
      step: { title: 'Sort by', choices: [{ id: 'title', label: 'Title', run: vi.fn() }] },
    }
    const { result } = setup([sort], true)
    act(() => result.current.setQuery('sort'))
    act(() => result.current.run(result.current.sections[0]!.items[0]!))
    act(() => result.current.setQuery('ti'))
    expect(result.current.step).toBe('Sort by')

    act(() => result.current.leaveStep())
    expect(result.current.step).toBeNull()
    expect(result.current.query).toBe('sort')
    expect(titlesIn(result.current.sections)).toEqual(['Sort by'])
  })

  it('starts empty, on the first step, each time it opens', async () => {
    const sort = {
      id: 'sort',
      label: 'Sort by',
      step: { title: 'Sort by', choices: [{ id: 'title', label: 'Title', run: vi.fn() }] },
    }
    const { result, rerender } = setup([sort], true)
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.setQuery('sort'))
    act(() => result.current.run(result.current.sections[0]!.items[0]!))
    act(() => result.current.setQuery('ti'))
    expect(result.current.step).toBe('Sort by')

    rerender({ open: false })
    rerender({ open: true })
    await expect.poll(() => result.current.query).toBe('')
    expect(result.current.step).toBeNull()
  })
})
