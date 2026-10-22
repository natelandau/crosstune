import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { SyncContext } from '../../sync/SyncProvider'
import { fakeEngine } from '../../test/fakeSync'
import { useLocationSnapshot } from './useLocationSnapshot'

const POINT = { lat: 36.66, lon: -80.92 }

function setup(placeSnapshot: (query: unknown) => Promise<string | null>) {
  const snapshot = vi.fn(placeSnapshot)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SyncContext.Provider value={fakeEngine({ placeSnapshot: snapshot })}>
      {children}
    </SyncContext.Provider>
  )
  const hook = renderHook(
    (props: { at: typeof POINT | null; accuracyM: number | null }) =>
      useLocationSnapshot(props.at, props.accuracyM, { width: 120, height: 90 }, 'dark'),
    { wrapper, initialProps: { at: POINT as typeof POINT | null, accuracyM: 80 as number | null } },
  )
  return { ...hook, snapshot }
}

it('returns the signed url', async () => {
  const { result, snapshot } = setup(async () => 'https://snapshot.test/a.png')
  await expect.poll(() => result.current).toBe('https://snapshot.test/a.png')
  expect(snapshot).toHaveBeenCalledWith({
    lat: 36.66,
    lon: -80.92,
    accuracy_m: 80,
    width: 120,
    height: 90,
    scheme: 'dark',
  })
})

it('leaves accuracy out when the point has none, which asks for a pin', async () => {
  const { result, rerender, snapshot } = setup(async () => 'u')
  await expect.poll(() => result.current).toBe('u')
  rerender({ at: POINT, accuracyM: null })
  await expect.poll(() => snapshot.mock.calls.length).toBe(2)
  expect(snapshot.mock.calls[1]![0]).not.toHaveProperty('accuracy_m', 80)
  expect(snapshot.mock.calls[1]![0]).toMatchObject({ lat: 36.66, lon: -80.92 })
})

it('is null when the url cannot be had', async () => {
  const { result, snapshot } = setup(async () => null)
  await expect.poll(() => snapshot.mock.calls.length).toBe(1)
  await act(async () => {})
  expect(result.current).toBeNull()
})

it('is null with no point, and asks nothing', async () => {
  const { result, rerender, snapshot } = setup(async () => 'u')
  await expect.poll(() => result.current).toBe('u')
  rerender({ at: null, accuracyM: null })
  expect(result.current).toBeNull()
  expect(snapshot).toHaveBeenCalledTimes(1)
})

it('drops the old url when the point changes', async () => {
  const urls = ['first', 'second']
  const { result, rerender } = setup(async () => urls.shift() ?? null)
  await expect.poll(() => result.current).toBe('first')
  rerender({ at: { lat: 1, lon: 2 }, accuracyM: null })
  expect(result.current).toBeNull()
  await expect.poll(() => result.current).toBe('second')
})
