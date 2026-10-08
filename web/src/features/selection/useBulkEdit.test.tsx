import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Instrument } from '../../api/vocabulary'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import type { CatalogEntry } from '../catalog/filters'
import { useBulkEdit } from './useBulkEdit'

const violin = new Set<Instrument>(['violin'])

let db: CrosstuneDb
let entries: CatalogEntry[]

beforeEach(async () => {
  db = openTestDb()
  entries = []
  for (const [title, key] of [
    ["Soldier's Joy", 'D'],
    ['Cluck Old Hen', 'A'],
  ] as const) {
    const { tuneId, userTuneId } = await createTune(db, { title, key }, { status: 'known' })
    entries.push({
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    })
  }
})

function setup({ pending = false } = {}) {
  const onApply = vi.fn()
  const onCancel = vi.fn()
  const view = renderHook(
    (props: { open: boolean; pending: boolean }) =>
      useBulkEdit({ ...props, entries, instruments: violin, onApply, onCancel }),
    { wrapper: dataProviders({ db }), initialProps: { open: true, pending } },
  )
  return { ...view, onApply, onCancel }
}

describe('useBulkEdit', () => {
  it('reads each field as shared, mixed, or empty', () => {
    const { result } = setup()
    expect(result.current.summaries.status).toEqual({ kind: 'shared', value: 'known' })
    expect(result.current.summaries.key).toEqual({ kind: 'mixed' })
    expect(result.current.summaries.genre).toEqual({ kind: 'empty' })
  })

  it('keeps Save off until a field is touched and writes only touched fields', () => {
    const { result, onApply } = setup()
    expect(result.current.canSave).toBe(false)
    act(() => result.current.save())
    expect(onApply).not.toHaveBeenCalled()

    act(() => result.current.touch('genre', 'Old-time'))
    expect(result.current.touchedCount).toBe(1)
    expect(result.current.canSave).toBe(true)
    act(() => result.current.save())
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({ tune: { genre: 'Old-time' }, userTune: {} })
  })

  it('untouches a field set back to the value every tune shares', () => {
    const { result } = setup()
    act(() => result.current.touch('status', 'learning'))
    expect(result.current.touchedCount).toBe(1)
    act(() => result.current.touch('status', 'known'))
    expect(result.current.touchedCount).toBe(0)
  })

  it('applies once until the caller reports the write settled', () => {
    const { result, rerender, onApply } = setup()
    act(() => result.current.touch('genre', 'Old-time'))
    act(() => result.current.save())
    act(() => result.current.save())
    expect(onApply).toHaveBeenCalledTimes(1)
    rerender({ open: true, pending: true })
    expect(result.current.canSave).toBe(false)
    rerender({ open: true, pending: false })
    act(() => result.current.save())
    expect(onApply).toHaveBeenCalledTimes(2)
  })

  it('starts each opening clean', () => {
    const { result, rerender } = setup()
    act(() => result.current.touch('genre', 'Old-time'))
    rerender({ open: false, pending: false })
    rerender({ open: true, pending: false })
    expect(result.current.touchedCount).toBe(0)
  })

  it('reports the dismissal of a reopened session', async () => {
    const { result, rerender, onCancel } = setup()
    act(() => result.current.dismissed())
    expect(onCancel).toHaveBeenCalledTimes(1)

    rerender({ open: false, pending: false })
    rerender({ open: true, pending: false })
    act(() => result.current.dismissed())
    await expect.poll(() => onCancel.mock.calls.length).toBe(2)
  })

  it('cancels through the dismissal, once', () => {
    const { result, onCancel } = setup()
    act(() => result.current.cancel())
    expect(result.current.closing).toBe(true)
    act(() => result.current.dismissed())
    act(() => result.current.dismissed())
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
