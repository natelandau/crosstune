import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useAction } from './useAction'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

it('stays pending until every overlapping action has settled', async () => {
  const { result } = renderHook(() => useAction())
  const first = deferred()
  const second = deferred()
  act(() => result.current.run(() => first.promise))
  act(() => result.current.run(() => second.promise))
  expect(result.current.pending).toBe(true)
  await act(async () => first.resolve())
  expect(result.current.pending).toBe(true)
  await act(async () => second.resolve())
  await waitFor(() => expect(result.current.pending).toBe(false))
})

it('ends the wait after a rejection, with its message', async () => {
  const { result } = renderHook(() => useAction())
  act(() => result.current.run(() => Promise.reject(new Error('Offline'))))
  await waitFor(() => expect(result.current.pending).toBe(false))
  expect(result.current.error).toBe('Offline')
})

it('returns the work, rejecting on failure with the error already shown', async () => {
  const { result } = renderHook(() => useAction())
  let work!: Promise<void>
  act(() => {
    work = result.current.attempt(() => Promise.reject(new Error('Offline')))
  })
  await expect(work).rejects.toThrow('Offline')
  await waitFor(() => expect(result.current.error).toBe('Offline'))
  expect(result.current.pending).toBe(false)
})

it('resolves the work once its success step has run', async () => {
  const { result } = renderHook(() => useAction())
  const steps: string[] = []
  let work!: Promise<void>
  act(() => {
    work = result.current.attempt(
      async () => steps.push('work'),
      () => steps.push('success'),
    )
  })
  await work
  expect(steps).toEqual(['work', 'success'])
})

it('treats a synchronous throw as a failure and ends the wait', async () => {
  const { result } = renderHook(() => useAction())
  const fail = (): Promise<void> => {
    throw new Error('Offline')
  }
  act(() => result.current.run(fail))
  await waitFor(() => expect(result.current.error).toBe('Offline'))
  expect(result.current.pending).toBe(false)
  let work!: Promise<void>
  act(() => {
    work = result.current.attempt(fail)
  })
  await expect(work).rejects.toThrow('Offline')
  await waitFor(() => expect(result.current.pending).toBe(false))
})
