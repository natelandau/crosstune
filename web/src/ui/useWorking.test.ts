import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useWorking, WORK_SUPERSEDED, type TrackWork } from './useWorking'

it('returns to idle after a failure, once onFailed has run', async () => {
  const onFailed = vi.fn()
  const { result } = renderHook(() =>
    useWorking(() => Promise.reject(new Error('Offline')), { onFailed }),
  )
  await act(async () => {
    result.current.press()
  })
  expect(onFailed).toHaveBeenCalledTimes(1)
  expect(result.current.state).toBe('idle')
})

it('takes another press after a failure', async () => {
  const work = vi.fn(() => Promise.reject(new Error('Offline')))
  const { result } = renderHook(() => useWorking(work))
  await act(async () => {
    result.current.press()
  })
  await act(async () => {
    result.current.press()
  })
  expect(work).toHaveBeenCalledTimes(2)
})

it('ends tracked work that was superseded with no check', async () => {
  const { result } = renderHook(() =>
    useWorking((track: TrackWork) => {
      void track(Promise.resolve(WORK_SUPERSEDED))
    }),
  )
  await act(async () => {
    result.current.press()
  })
  expect(result.current.state).toBe('idle')
})

it('shows the check for tracked work that lands', async () => {
  const { result } = renderHook(() =>
    useWorking((track: TrackWork) => {
      void track(Promise.resolve())
    }),
  )
  await act(async () => {
    result.current.press()
  })
  expect(result.current.state).toBe('done')
})
