import { act, render, renderHook, waitFor } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createList } from '../commands/lists'
import { openTestDb } from '../test/db'
import { DbContext } from './DbProvider'
import type { CrosstuneDb } from './schema'
import { createSharedLiveQuery } from './sharedLiveQuery'

function setup() {
  const db = openTestDb()
  const query = vi.fn((db: CrosstuneDb) => db.lists.count())
  const useCount = createSharedLiveQuery(query)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DbContext.Provider value={db}>{children}</DbContext.Provider>
  )
  return { db, query, useCount, wrapper }
}

class Boundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

describe('createSharedLiveQuery', () => {
  it('hands a second reader the running query instead of starting another', async () => {
    const { query, useCount, wrapper } = setup()
    const first = renderHook(() => useCount(), { wrapper })
    await waitFor(() => expect(first.result.current).toBe(0))
    const runs = query.mock.calls.length

    const second = renderHook(() => useCount(), { wrapper })

    expect(second.result.current).toBe(0)
    expect(query).toHaveBeenCalledTimes(runs)
  })

  it('follows writes to the tables it reads', async () => {
    const { db, useCount, wrapper } = setup()
    const { result } = renderHook(() => useCount(), { wrapper })
    await waitFor(() => expect(result.current).toBe(0))

    await act(() => createList(db, 'Tuesday jam'))

    await waitFor(() => expect(result.current).toBe(1))
  })

  it('stands down once nothing reads it, so a later reader starts fresh', async () => {
    const { db, useCount, wrapper } = setup()
    const first = renderHook(() => useCount(), { wrapper })
    await waitFor(() => expect(first.result.current).toBe(0))
    first.unmount()
    await createList(db, 'Tuesday jam')

    const second = renderHook(() => useCount(), { wrapper })

    // A query still running would hand its last result straight to the new reader.
    expect(second.result.current).toBeUndefined()
    await waitFor(() => expect(second.result.current).toBe(1))
  })

  it('throws a failed read to the error boundary above its reader', async () => {
    const db = openTestDb()
    const failure = new Error('read failed')
    const useBroken = createSharedLiveQuery<number>(() => Promise.reject(failure))
    const onError = vi.fn()
    // React logs every error a boundary catches.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    onTestFinished(() => log.mockRestore())

    renderHook(() => useBroken(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DbContext.Provider value={db}>
          <Boundary onError={onError}>{children}</Boundary>
        </DbContext.Provider>
      ),
    })

    await waitFor(() => expect(onError).toHaveBeenCalledWith(failure))
  })

  it('hands its value straight to a reader that replaces the last one in the same commit', async () => {
    const { useCount, wrapper } = setup()
    const seen: Record<'before' | 'after', (number | undefined)[]> = { before: [], after: [] }
    function Reader({ name }: { name: 'before' | 'after' }) {
      seen[name].push(useCount())
      return null
    }
    const view = render(<Reader key="before" name="before" />, { wrapper })
    await expect.poll(() => seen.before.at(-1)).toBe(0)

    view.rerender(<Reader key="after" name="after" />)

    await expect.poll(() => seen.after.at(-1)).toBe(0)
    expect(seen.after).not.toContain(undefined)
  })
})
