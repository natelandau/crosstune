import { renderHook } from '@testing-library/react'
import { expect, it, onTestFinished } from 'vitest'
import { fakeLocationPermissionForTest } from '../test/fakeLocationPermission'
import { useLocationPermission } from './locationPermission'

it('is null until the browser answers, then its answer', async () => {
  fakeLocationPermissionForTest('denied')
  const { result } = renderHook(() => useLocationPermission())
  expect(result.current).toBeNull()
  await expect.poll(() => result.current).toBe('denied')
})

it('follows a change made in the browser’s settings', async () => {
  const permission = fakeLocationPermissionForTest('prompt')
  const { result } = renderHook(() => useLocationPermission())
  await expect.poll(() => result.current).toBe('prompt')
  permission.set('granted')
  await expect.poll(() => result.current).toBe('granted')
})

it('is unknown when the browser cannot say', async () => {
  fakeLocationPermissionForTest('unknown')
  const { result } = renderHook(() => useLocationPermission())
  await expect.poll(() => result.current).toBe('unknown')
})

it('is unknown with no Permissions API', async () => {
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined })
  onTestFinished(() => void Reflect.deleteProperty(navigator, 'permissions'))
  const { result } = renderHook(() => useLocationPermission())
  await expect.poll(() => result.current).toBe('unknown')
})
